import { Injectable } from '@nestjs/common';
import { type Prisma, type User } from '@prisma/client';
import { UsersRepository } from '../../domain/repositories/users.repository';
import { PrismaService } from '../../../../shared/database/prisma.service';

@Injectable()
export class UsersPrismaRepository implements UsersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prismaService.user.create({ data });
  }

  findUnique(
    where: Prisma.UserWhereUniqueInput,
    select?: Prisma.UserSelect,
  ): Promise<Partial<User> | null> {
    return this.prismaService.user.findUnique({ where, select });
  }
}
