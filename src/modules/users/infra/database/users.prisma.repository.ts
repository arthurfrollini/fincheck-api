import { Injectable } from '@nestjs/common';
import { type Prisma, type User } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { UsersRepository } from '../../domain/repositories/users.repository';

@Injectable()
export class UsersPrismaRepository implements UsersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(userCreateDto: Prisma.UserCreateInput): Promise<User> {
    return this.prismaService.user.create({ data: userCreateDto });
  }

  findById(userId: string): Promise<User | null> {
    return this.prismaService.user.findUnique({ where: { id: userId } });
  }

  findByEmail(userEmail: string): Promise<User | null> {
    return this.prismaService.user.findUnique({ where: { email: userEmail } });
  }

  findMany(): Promise<User[]> {
    return this.prismaService.user.findMany();
  }

  update(userId: string, userUpdateDto: Prisma.UserUpdateInput): Promise<User> {
    return this.prismaService.user.update({
      where: { id: userId },
      data: userUpdateDto,
    });
  }

  async delete(userId: string): Promise<void> {
    await this.prismaService.user.delete({ where: { id: userId } });
  }

  findByEmailToken(token: string): Promise<User | null> {
    return this.prismaService.user.findUnique({ where: { emailToken: token } });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.prismaService.user.findUnique({ where: { googleId } });
  }
}
