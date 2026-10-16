import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { metrics, type Counter } from '@opentelemetry/api';
import { LlmService } from '@shared/llm/llm.service';
import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';
import { AgentRunsRepository } from '../domain/repositories/agent-runs.repository';
import { type FinishedStatus } from '../entities/AgentRun';
import {
  AGENT_MAX_TOKENS,
  AGENT_MODEL,
  INCOMPLETE_ANSWER,
  MAX_CONSECUTIVE_FAILED_ROUNDS,
  MAX_STEPS,
  REFUSAL_ANSWER,
  TOOL_FAILURE_ANSWER,
  agentSystemPrompt,
} from './agent.constants';
import {
  AGENT_TOOLS,
  buildToolHandlers,
  runTool,
  type ToolHandlers,
} from './agent-tools';

export interface TraceEntry {
  tool: string;
  input: unknown;
  result: unknown;
  isError: boolean;
}

export interface AgentLoopResult {
  status: Exclude<FinishedStatus, 'FAILED'>;
  answer: string;
  steps: number;
  trace: TraceEntry[];
}

const parseResult = (r: Anthropic.ToolResultBlockParam): unknown => {
  try {
    return JSON.parse(r.content as string);
  } catch {
    return r.content;
  }
};

// The tool loop, free of Nest and the database so it can be tested with a
// scripted model and reused by the eval. Model API errors propagate: the
// queue retries the whole run (tools are read-only, so that's safe).
export async function runAgentLoop(opts: {
  question: string;
  llm: Pick<LlmService, 'complete'>;
  handlers: ToolHandlers;
  now: Date;
}): Promise<AgentLoopResult> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: opts.question },
  ];
  const trace: TraceEntry[] = [];
  let failedRounds = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const message = await opts.llm.complete('agent', {
      model: AGENT_MODEL,
      max_tokens: AGENT_MAX_TOKENS,
      system: agentSystemPrompt(opts.now),
      tools: AGENT_TOOLS,
      output_config: { effort: 'medium' },
      messages,
    });

    if (message.stop_reason === 'refusal') {
      return { status: 'DEGRADED', answer: REFUSAL_ANSWER, steps: step, trace };
    }

    // Append-only: the assistant turn goes back exactly as received,
    // thinking blocks included, or the model's reasoning chain breaks.
    messages.push({
      role: 'assistant',
      content: message.content,
    });

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (toolUses.length === 0) {
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return text && message.stop_reason === 'end_turn'
        ? { status: 'COMPLETED', answer: text, steps: step, trace }
        : { status: 'DEGRADED', answer: INCOMPLETE_ANSWER, steps: step, trace };
    }

    // All results of a round go back in one user message; splitting them
    // teaches the model to stop calling tools in parallel.
    const results = await Promise.all(
      toolUses.map((use) => runTool(opts.handlers, use)),
    );
    messages.push({ role: 'user', content: results });
    toolUses.forEach((use, i) =>
      trace.push({
        tool: use.name,
        input: use.input,
        result: parseResult(results[i]),
        isError: results[i].is_error === true,
      }),
    );

    failedRounds = results.every((r) => r.is_error) ? failedRounds + 1 : 0;
    if (failedRounds >= MAX_CONSECUTIVE_FAILED_ROUNDS) {
      return {
        status: 'DEGRADED',
        answer: TOOL_FAILURE_ANSWER,
        steps: step,
        trace,
      };
    }
  }

  return {
    status: 'DEGRADED',
    answer: INCOMPLETE_ANSWER,
    steps: MAX_STEPS,
    trace,
  };
}

@Injectable()
export class RunAgentService {
  private readonly runs: Counter;

  constructor(
    private readonly agentRunsRepository: AgentRunsRepository,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly categoriesRepository: CategoriesRepository,
    private readonly llmService: LlmService,
  ) {
    this.runs = metrics
      .getMeter('fincheck-api')
      .createCounter('fincheck_agent_runs', {
        description: 'Agent runs finished, by status',
      });
  }

  async run(runId: string): Promise<void> {
    const run = await this.agentRunsRepository.findById(runId);
    // Already finished (a duplicate delivery): nothing to redo.
    if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) return;

    await this.agentRunsRepository.markRunning(runId);
    const result = await runAgentLoop({
      question: run.question,
      llm: this.llmService,
      // userId comes from the stored run, which came from the authenticated
      // request. Nothing the model sends can change it.
      handlers: buildToolHandlers(run.userId, {
        transactions: this.transactionsRepository,
        categories: this.categoriesRepository,
      }),
      now: new Date(),
    });

    await this.agentRunsRepository.finish(runId, {
      status: result.status,
      answer: result.answer,
      steps: result.steps,
    });
    this.runs.add(1, { status: result.status });
  }
}
