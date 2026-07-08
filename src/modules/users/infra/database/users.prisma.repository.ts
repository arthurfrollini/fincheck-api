import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { UsersRepository } from '../../domain/repositories/users.repository';
import {
  type UserCreate,
  type UserEntity,
  type UserUpdate,
} from '../../entities/User';

@Injectable()
export class UsersPrismaRepository implements UsersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: UserCreate): Promise<UserEntity> {
    const { categories, ...rest } = data;
    return this.prismaService.user.create({
      data: {
        ...rest,
        ...(categories && {
          categories: { createMany: { data: categories } },
        }),
      },
    });
  }

  findById(userId: string): Promise<UserEntity | null> {
    return this.prismaService.user.findUnique({ where: { id: userId } });
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.prismaService.user.findUnique({ where: { email } });
  }

  findMany(): Promise<UserEntity[]> {
    return this.prismaService.user.findMany();
  }

  update(userId: string, data: UserUpdate): Promise<UserEntity> {
    return this.prismaService.user.update({ where: { id: userId }, data });
  }

  async delete(userId: string): Promise<void> {
    await this.prismaService.user.delete({ where: { id: userId } });
  }

  findByEmailToken(token: string): Promise<UserEntity | null> {
    return this.prismaService.user.findUnique({ where: { emailToken: token } });
  }

  findByGoogleId(googleId: string): Promise<UserEntity | null> {
    return this.prismaService.user.findUnique({ where: { googleId } });
  }
}
