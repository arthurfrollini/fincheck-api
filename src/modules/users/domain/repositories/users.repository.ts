import { type Prisma, type User } from '@prisma/client';

export abstract class UsersRepository {
  abstract create(data: Prisma.UserCreateInput): Promise<User>;
  abstract findUnique(where: Prisma.UserFindUniqueArgs): Promise<User | null>;
  abstract findMany(): Promise<User[]>;
  abstract update(userId: string, data: Prisma.UserUpdateInput): Promise<User>;
  abstract delete(userId: string): Promise<void>;
  abstract findByEmailToken(token: string): Promise<User | null>;
}
