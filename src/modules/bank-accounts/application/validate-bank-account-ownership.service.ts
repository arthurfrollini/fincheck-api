import { Injectable, NotFoundException } from '@nestjs/common';
import { BankAccountsRepository } from '../domain/repositories/bank-accounts.repository';

@Injectable()
export class ValidateBankAccountOwnershipService {
  constructor(
    private readonly bankAccountsRepository: BankAccountsRepository,
  ) {}

  async validate(userId: string, bankAccountId: string) {
    const isOwner = await this.bankAccountsRepository.findFirst({
      where: { id: bankAccountId, userId },
    });

    if (!isOwner) throw new NotFoundException('Bank account not found.');

    return isOwner;
  }
}
