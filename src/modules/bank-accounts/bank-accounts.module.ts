import { Module } from '@nestjs/common';
import { BankAccountsController } from './infra/http/bank-accounts.controller';
import { BankAccountsService } from './application/bank-accounts.service';
import { ValidateBankAccountOwnershipService } from './application/validate-bank-account-ownership.service';
import { BankAccountsRepository } from './domain/repositories/bank-accounts.repository';
import { BankAccountsPrismaRepository } from './infra/database/bank-accounts.prisma.repository';

@Module({
  controllers: [BankAccountsController],
  providers: [
    BankAccountsService,
    ValidateBankAccountOwnershipService,
    {
      provide: BankAccountsRepository,
      useClass: BankAccountsPrismaRepository,
    },
  ],
  exports: [ValidateBankAccountOwnershipService],
})
export class BankAccountsModule {}
