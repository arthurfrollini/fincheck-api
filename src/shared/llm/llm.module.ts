import { Global, Module } from '@nestjs/common';
import { env } from '@shared/config/env';
import { createAnthropicClient } from './anthropic-client';
import { LlmService } from './llm.service';
import { LlmMetrics } from './llm.metrics';
import { AiUsageRepository } from './ai-usage.repository';
import { AiUsagePrismaRepository } from './ai-usage.prisma.repository';
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
    { provide: AiUsageRepository, useClass: AiUsagePrismaRepository },
  ],
  exports: [LlmService, AiUsageRepository],
})
export class LlmModule {}
