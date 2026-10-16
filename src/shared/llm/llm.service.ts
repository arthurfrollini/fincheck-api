import { Inject, Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type ZodType } from 'zod';
import { computeCostUsd, type LlmModel } from './llm-pricing';
import { LlmMetrics } from './llm.metrics';
import {
  ANTHROPIC_CLIENT,
  type LlmFeature,
  type LlmOutcome,
} from './llm.types';

// Haiku 5.5 switches to a pricier rate card above this prompt size;
// computeCostUsd only knows the cheaper one.
const HAIKU_SMALL_PROMPT_LIMIT = 100_000;

export type LlmParams = Anthropic.MessageCreateParamsNonStreaming & {
  model: LlmModel;
};

export type LlmResult<T> = Anthropic.Message & { parsed_output: T | null };

@Injectable()
export class LlmService {
  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    private readonly llmMetrics: LlmMetrics,
    @InjectPinoLogger(LlmService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Uses messages.create and validates the JSON here rather than through
  // messages.parse: parse throws on output that fails the schema (a refusal
  // mid-answer, an id outside the enum), which would lose the usage record
  // and turn a bad answer into a retried, re-billed job. A bad answer is
  // parsed_output: null instead. Typed SDK errors still propagate unchanged
  // so callers can decide what is retryable.
  async parse<T>(
    feature: LlmFeature,
    params: LlmParams,
    schema: ZodType<T>,
    context: Record<string, string> = {},
  ): Promise<LlmResult<T>> {
    const startedAt = performance.now();

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(params);
    } catch (err) {
      this.llmMetrics.record(params.model, feature, null, 'error');
      throw err;
    }

    const parsed = parseOutput(message, schema);
    const { usage } = message;
    this.llmMetrics.record(
      params.model,
      feature,
      usage,
      outcomeOf(message, parsed),
    );

    if (
      params.model === 'claude-haiku-5-5' &&
      usage.input_tokens > HAIKU_SMALL_PROMPT_LIMIT
    ) {
      this.logger.warn(
        { feature, model: params.model, input_tokens: usage.input_tokens },
        'Prompt exceeded the Haiku 5.5 small-prompt rate card; logged cost is underestimated',
      );
    }

    // Never log params or content: they carry user financial data.
    this.logger.info(
      {
        feature,
        model: params.model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cost_usd: computeCostUsd(params.model, usage),
        latency_ms: Math.round(performance.now() - startedAt),
        stop_reason: message.stop_reason,
        ...context,
      },
      'LLM call',
    );

    return { ...message, parsed_output: parsed };
  }
}

// A refused or truncated answer is never parsed, even if its partial text
// happens to be valid JSON.
function parseOutput<T>(
  message: Anthropic.Message,
  schema: ZodType<T>,
): T | null {
  if (
    message.stop_reason === 'refusal' ||
    message.stop_reason === 'max_tokens'
  ) {
    return null;
  }
  const text = message.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!text) return null;
  try {
    const result = schema.safeParse(JSON.parse(text.text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function outcomeOf(message: Anthropic.Message, parsed: unknown): LlmOutcome {
  if (message.stop_reason === 'refusal') return 'refusal';
  if (message.stop_reason === 'max_tokens') return 'max_tokens';
  if (parsed === null) return 'unparsed';
  return 'ok';
}
