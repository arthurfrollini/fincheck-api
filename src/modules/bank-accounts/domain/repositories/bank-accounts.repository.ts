import {
  type BankAccountCreate,
  type BankAccountEntity,
  type BankAccountUpdate,
  type BankAccountWithTransactions,
} from '../../entities/BankAccount';

export abstract class BankAccountsRepository {
  abstract create(data: BankAccountCreate): Promise<BankAccountEntity>;
  abstract findManyWithTransactions(
    userId: string,
  ): Promise<BankAccountWithTransactions[]>;
  abstract findFirst(
    id: string,
    userId: string,
  ): Promise<BankAccountEntity | null>;
  abstract update(
    id: string,
    data: BankAccountUpdate,
  ): Promise<BankAccountEntity>;
  abstract delete(id: string): Promise<void>;
}
