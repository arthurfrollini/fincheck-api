import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionsRepository } from '../domain/repositories/transactions.repository';

@Injectable()
export class ValidateTransactionOwnershipService {
  constructor(
    private readonly transactionsRepository: TransactionsRepository,
  ) {}

  async validate(userId: string, transactionId: string) {
    const isOwner = await this.transactionsRepository.findFirst(
      transactionId,
      userId,
    );

    if (!isOwner) throw new NotFoundException('Transaction not found.');

    return isOwner;
  }
}
