import { Module } from '@nestjs/common';
import { TransactionsController } from './infra/http/transactions.controller';
import { TransactionsService } from './application/transactions.service';
import { TransactionsRepository } from './domain/repositories/transactions.repository';
import { TransactionsPrismaRepository } from './infra/database/transactions.prisma.repository';
import { BankAccountsModule } from '@modules/bank-accounts/bank-accounts.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { ValidateTransactionOwnershipService } from './application/validate-transaction-ownership.service';

@Module({
  imports: [BankAccountsModule, CategoriesModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    ValidateTransactionOwnershipService,
    {
      provide: TransactionsRepository,
      useClass: TransactionsPrismaRepository,
    },
  ],
})
export class TransactionsModule {}
