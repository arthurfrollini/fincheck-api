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

  findUnique(data: Prisma.UserFindUniqueArgs): Promise<User | null> {
    return this.prismaService.user.findUnique(data);
  }

  findMany(): Promise<User[]> {
    return this.prismaService.user.findMany();
  }

  update(userId: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prismaService.user.update({ where: { id: userId }, data });
  }

  async delete(userId: string): Promise<void> {
    await this.prismaService.user.delete({ where: { id: userId } });
  }
}
