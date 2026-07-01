import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../../../shared/decorators/roles.decorator';
import { ActiveUserId } from '../../../../shared/decorators/active-user-id.decorator';
import { UsersService } from '../../application/users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('/me')
  me(@ActiveUserId() userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Get()
  @Roles(Role.ADMINISTRATOR)
  listAll() {
    return this.usersService.listAll();
  }
}
