import { Injectable } from '@nestjs/common';
import { BankAccountsRepository } from '../domain/repositories/bank-accounts.repository';
import { ValidateBankAccountOwnershipService } from './validate-bank-account-ownership.service';
import { CreateBankAccountDto } from '../infra/http/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../infra/http/dto/update-bank-account.dto';

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly bankAccountsRepository: BankAccountsRepository,
    private readonly validateBankAccountOwnershipService: ValidateBankAccountOwnershipService,
  ) {}

  create(userId: string, dto: CreateBankAccountDto) {
    const { name, color, initialBalance, type } = dto;
    return this.bankAccountsRepository.create({
      data: { userId, name, color, initialBalance, type },
    });
  }

  findAllByUserId(userId: string) {
    return this.bankAccountsRepository.findMany(userId);
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
