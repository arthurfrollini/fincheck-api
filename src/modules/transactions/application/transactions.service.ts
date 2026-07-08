import { Injectable } from '@nestjs/common';
import { CreateTransactionDto } from '../infra/http/dto/create-transaction.dto';
import { UpdateTransactionDto } from '../infra/http/dto/update-transaction.dto';
import { TransactionsRepository } from '../domain/repositories/transactions.repository';
import { ValidateBankAccountOwnershipService } from '@modules/bank-accounts/application/validate-bank-account-ownership.service';
import { ValidateCategoryOwnershipService } from '@modules/categories/application/validate-category-ownership.service';
import { ValidateTransactionOwnershipService } from './validate-transaction-ownership.service';
import { type TransactionFilters } from '../entities/Transaction';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly transactionsRepository: TransactionsRepository,
    private readonly validateBankAccountOwnershipService: ValidateBankAccountOwnershipService,
    private readonly validateCategoryOwnershipService: ValidateCategoryOwnershipService,
    private readonly validateTransactionOwnershipService: ValidateTransactionOwnershipService,
  ) {}

  async create(userId: string, createTransactionDto: CreateTransactionDto) {
    const { bankAccountId, categoryId, name, value, date, type } =
      createTransactionDto;

    await this.validateEntitiesOwnership({ userId, bankAccountId, categoryId });

    return this.transactionsRepository.create({
      userId,
      bankAccountId,
      categoryId,
      name,
      value,
      date: new Date(date),
      type,
    });
  }

  async findAllByUserId(userId: string, filters: TransactionFilters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const { data, total } = await this.transactionsRepository.findMany(userId, {
      ...filters,
      page,
      limit,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: { total, page, limit, totalPages },
    };
  }

  async update(
    userId: string,
    transactionId: string,
    updateTransactionDto: UpdateTransactionDto,
  ) {
    const { bankAccountId, categoryId, name, value, date, type } =
      updateTransactionDto;

    await this.validateEntitiesOwnership({
      userId,
      bankAccountId,
      categoryId,
      transactionId,
    });

    return this.transactionsRepository.update(transactionId, {
      bankAccountId,
      categoryId,
      name,
      value,
      date: new Date(date),
      type,
    });
  }

  async remove(userId: string, transactionId: string) {
    await this.validateEntitiesOwnership({
      userId,
      transactionId,
    });

    await this.transactionsRepository.delete(transactionId);
  }

  private async validateEntitiesOwnership({
    userId,
    bankAccountId,
    categoryId,
    transactionId,
  }: {
    userId: string;
    bankAccountId?: string;
    categoryId?: string;
    transactionId?: string;
  }) {
    await Promise.all([
      transactionId &&
        this.validateTransactionOwnershipService.validate(
          userId,
          transactionId,
        ),
      bankAccountId &&
        this.validateBankAccountOwnershipService.validate(
          userId,
          bankAccountId,
        ),
      categoryId &&
        this.validateCategoryOwnershipService.validate(userId, categoryId),
    ]);
  }
}
