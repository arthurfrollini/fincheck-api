import {
  type UserCreate,
  type UserEntity,
  type UserUpdate,
} from '../../entities/User';

export abstract class UsersRepository {
  abstract create(data: UserCreate): Promise<UserEntity>;
  abstract findById(userId: string): Promise<UserEntity | null>;
  abstract findByEmail(email: string): Promise<UserEntity | null>;
  abstract findMany(): Promise<UserEntity[]>;
  abstract update(userId: string, data: UserUpdate): Promise<UserEntity>;
  abstract delete(userId: string): Promise<void>;
  abstract findByEmailToken(token: string): Promise<UserEntity | null>;
  abstract findByStripeCustomerId(customerId: string): Promise<UserEntity | null>;
  abstract findByGoogleId(googleId: string): Promise<UserEntity | null>;
}
