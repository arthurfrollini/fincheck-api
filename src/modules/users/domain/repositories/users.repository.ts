import { type Prisma, type User } from '@prisma/client';

export abstract class UsersRepository {
  abstract create(data: Prisma.UserCreateInput): Promise<User>;
  abstract findUnique(
    where: Prisma.UserWhereUniqueInput,
    select?: Prisma.UserSelect,
  ): Promise<Partial<User> | null>;
}
