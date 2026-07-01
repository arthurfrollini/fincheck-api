import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './repositories/users.repository';
import { UsersPrismaRepository } from '../../shared/database/repositories/users.prisma.repository';

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
