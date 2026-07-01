import { Module } from '@nestjs/common';
import { UsersController } from './infra/http/users.controller';
import { UsersService } from './application/users.service';
import { UsersRepository } from './domain/repositories/users.repository';
import { UsersPrismaRepository } from './infra/database/users.prisma.repository';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      provide: UsersRepository,
      useClass: UsersPrismaRepository,
    },
  ],
})
export class UsersModule {}
