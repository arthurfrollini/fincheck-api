import { Injectable } from '@nestjs/common';
import { BankAccountsRepository } from '../domain/repositories/bank-accounts.repository';
import { ValidateBankAccountOwnershipService } from './validate-bank-account-ownership.service';
import { CreateBankAccountDto } from '../infra/http/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../infra/http/dto/update-bank-account.dto';
import { TransactionType } from '@modules/transactions/entities/Transaction';

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly bankAccountsRepository: BankAccountsRepository,
    private readonly validateBankAccountOwnershipService: ValidateBankAccountOwnershipService,
  ) {}

  create(userId: string, dto: CreateBankAccountDto) {
    const { name, color, initialBalance, type } = dto;
    return this.bankAccountsRepository.create({
      userId,
      name,
      color,
      initialBalance,
      type,
    });
  }

  async findAllByUserId(userId: string) {
    const bankAccounts =
      await this.bankAccountsRepository.findManyWithTransactions(userId);

    return bankAccounts.map(({ transactions, ...bankAccount }) => {
      const totalTransactions = transactions.reduce(
        (acc, transaction) =>
          acc +
          (transaction.type === TransactionType.INCOME
            ? transaction.value
            : -transaction.value),
        0,
      );

      const currentBalance = bankAccount.initialBalance + totalTransactions;

      return {
        ...bankAccount,
        currentBalance,
      };
    });
  }

  async update(
    userId: string,
    bankAccountId: string,
    dto: UpdateBankAccountDto,
  ) {
    await this.validateBankAccountOwnershipService.validate(
      userId,
      bankAccountId,
    );

    const { name, color, initialBalance, type } = dto;
    return this.bankAccountsRepository.update(bankAccountId, {
      name,
      color,
      initialBalance,
      type,
    });
  }

  async remove(userId: string, bankAccountId: string) {
    await this.validateBankAccountOwnershipService.validate(
      userId,
      bankAccountId,
    );

    await this.bankAccountsRepository.delete(bankAccountId);
  }
}
