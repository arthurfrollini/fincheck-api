import { Global, Module } from '@nestjs/common';
import { env } from '@shared/config/env';
import { createAnthropicClient } from './anthropic-client';
import { LlmService } from './llm.service';
import { LlmMetrics } from './llm.metrics';
import { ANTHROPIC_CLIENT } from './llm.types';

@Global()
@Module({
  providers: [
    {
      provide: ANTHROPIC_CLIENT,
      useFactory: () => createAnthropicClient(env.anthropicApiKey),
    },
    LlmMetrics,
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
