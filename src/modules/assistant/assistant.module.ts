import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CategoriesModule } from '@modules/categories/categories.module';
import { TransactionsModule } from '@modules/transactions/transactions.module';
import { AssistantService } from './application/assistant.service';
import { RunAgentService } from './application/run-agent.service';
import { AgentRunsRepository } from './domain/repositories/agent-runs.repository';
import { AgentRunsPrismaRepository } from './infra/database/agent-runs.prisma.repository';
import { AssistantController } from './infra/http/assistant.controller';
import { AGENT_QUEUE_NAME } from './infra/queue/agent-job.types';
import { AgentQueueService } from './infra/queue/agent-queue.service';
import { AgentProcessor } from './infra/queue/agent.processor';

@Module({
  imports: [
    TransactionsModule,
    CategoriesModule,
    BullModule.registerQueue({ name: AGENT_QUEUE_NAME }),
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    RunAgentService,
    AgentQueueService,
    AgentProcessor,
    { provide: AgentRunsRepository, useClass: AgentRunsPrismaRepository },
  ],
})
export class AssistantModule {}
