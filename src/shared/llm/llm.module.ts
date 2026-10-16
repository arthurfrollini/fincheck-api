import { Global, Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@shared/config/env';
import { LlmService } from './llm.service';
import { LlmMetrics } from './llm.metrics';
import { ANTHROPIC_CLIENT } from './llm.types';

@Global()
@Module({
  providers: [
    {
      provide: ANTHROPIC_CLIENT,
      // BullMQ owns retries for every LLM call path; SDK retries on top
      // would multiply attempts (3 SDK tries x N job attempts).
      useFactory: () =>
        new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 0 }),
    },
    LlmMetrics,
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
