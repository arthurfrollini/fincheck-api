import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { metrics, type Counter } from '@opentelemetry/api';
import { computeCostUsd, type LlmModel } from './llm-pricing';
import { type LlmFeature, type LlmOutcome } from './llm.types';

@Injectable()
export class LlmMetrics {
  private readonly tokens: Counter;
  private readonly costUsd: Counter;
  private readonly requests: Counter;

  constructor() {
    const meter = metrics.getMeter('fincheck-api');
    this.tokens = meter.createCounter('fincheck_llm_tokens', {
      description: 'Tokens billed by the Claude API, by direction',
    });
    this.costUsd = meter.createCounter('fincheck_llm_cost_usd', {
      description: 'Estimated Claude API spend in USD',
    });
    this.requests = meter.createCounter('fincheck_llm_requests', {
      description: 'Claude API calls, by outcome',
    });
  }

  record(
    model: LlmModel,
    feature: LlmFeature,
    usage: Anthropic.Usage | null,
    outcome: LlmOutcome,
  ): void {
    const labels = { model, feature };

    if (usage) {
      const directions = {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_read: usage.cache_read_input_tokens ?? 0,
        cache_write: usage.cache_creation_input_tokens ?? 0,
      };
      for (const [direction, count] of Object.entries(directions)) {
        if (count > 0) this.tokens.add(count, { ...labels, direction });
      }
      this.costUsd.add(computeCostUsd(model, usage), labels);
    }

    this.requests.add(1, { ...labels, outcome });
  }
}
