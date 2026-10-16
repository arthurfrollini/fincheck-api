import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TransactionsController } from './infra/http/transactions.controller';
import { TransactionsService } from './application/transactions.service';
import { TransactionsRepository } from './domain/repositories/transactions.repository';
import { TransactionsPrismaRepository } from './infra/database/transactions.prisma.repository';
import { BankAccountsModule } from '@modules/bank-accounts/bank-accounts.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { ValidateTransactionOwnershipService } from './application/validate-transaction-ownership.service';
import { CategorizeTransactionService } from './application/categorize-transaction.service';
import { CategorizationQueueService } from './infra/queue/categorization-queue.service';
import { CategorizationProcessor } from './infra/queue/categorization.processor';
import { CATEGORIZATION_QUEUE_NAME } from './infra/queue/categorization-job.types';

@Module({
  imports: [
    BankAccountsModule,
    CategoriesModule,
    BullModule.registerQueue({ name: CATEGORIZATION_QUEUE_NAME }),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    ValidateTransactionOwnershipService,
    CategorizeTransactionService,
    CategorizationQueueService,
    CategorizationProcessor,
    {
      provide: TransactionsRepository,
      useClass: TransactionsPrismaRepository,
    },
  ],
  exports: [TransactionsRepository],
})
export class TransactionsModule {}
