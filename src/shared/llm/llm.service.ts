import { Inject, Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ExtractParsedContentFromParams,
  ParsedMessage,
} from '@anthropic-ai/sdk/lib/parser';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
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

type LlmParams = Anthropic.MessageCreateParamsNonStreaming & {
  model: LlmModel;
};

@Injectable()
export class LlmService {
  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    private readonly llmMetrics: LlmMetrics,
    @InjectPinoLogger(LlmService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Typed SDK errors propagate unchanged: callers decide what is retryable.
  async parse<Params extends LlmParams>(
    feature: LlmFeature,
    params: Params,
    context: Record<string, string> = {},
  ): Promise<ParsedMessage<ExtractParsedContentFromParams<Params>>> {
    const startedAt = performance.now();

    let response: ParsedMessage<ExtractParsedContentFromParams<Params>>;
    try {
      response = await this.client.messages.parse(params);
    } catch (err) {
      this.llmMetrics.record(params.model, feature, null, 'error');
      throw err;
    }

    const { usage } = response;
    this.llmMetrics.record(params.model, feature, usage, outcomeOf(response));

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
        stop_reason: response.stop_reason,
        ...context,
      },
      'LLM call',
    );

    return response;
  }
}

function outcomeOf(response: {
  stop_reason: Anthropic.StopReason | null;
  parsed_output: unknown;
}): LlmOutcome {
  if (response.stop_reason === 'refusal') return 'refusal';
  if (response.stop_reason === 'max_tokens') return 'max_tokens';
  if (response.parsed_output === null) return 'unparsed';
  return 'ok';
}
