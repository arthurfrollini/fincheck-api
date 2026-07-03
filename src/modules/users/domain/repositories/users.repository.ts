import { type Prisma, type User } from '@prisma/client';

export abstract class UsersRepository {
  abstract create(userCreateDto: Prisma.UserCreateInput): Promise<User>;
  abstract findById(userId: string): Promise<User | null>;
  abstract findByEmail(userEmail: string): Promise<User | null>;
  abstract findMany(): Promise<User[]>;
  abstract update(
    userId: string,
    userUpdateDto: Prisma.UserUpdateInput,
  ): Promise<User>;
  abstract delete(userId: string): Promise<void>;
  abstract findByEmailToken(token: string): Promise<User | null>;
  abstract findByGoogleId(userGoogleId: string): Promise<User | null>;
}
