import { Controller, Get } from '@nestjs/common';
import { ActiveUserId } from '../../../../shared/decorators/active-user-id.decorator';
import { UsersService } from '../../application/users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('/me')
  me(@ActiveUserId() userId: string) {
    return this.usersService.getUserById(userId);
  }
}
