import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsAdministrator } from '@shared/decorators/roles.decorator';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { isPublic } from '@shared/decorators/public.decorator';
import { UsersService } from '../../application/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('/me')
  me(@ActiveUserId() userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Patch('/me')
  updateMe(@ActiveUserId() userId: string, @Body() { name }: UpdateMeDto) {
    return this.usersService.updateMe(userId, name);
  }

  @Patch('/me/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestEmailChange(
    @ActiveUserId() userId: string,
    @Body() requestEmailChangeDto: RequestEmailChangeDto,
  ) {
    return this.usersService.requestEmailChange(
      userId,
      requestEmailChangeDto.newEmail,
    );
  }

  @Get('/confirm-email')
  @isPublic()
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmEmailChange(@Query('token') token: string) {
    return this.usersService.confirmEmailChange(token);
  }

  @Get()
  @IsAdministrator()
  listAll() {
    return this.usersService.listAll();
  }

  @Post()
  @IsAdministrator()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createByAdmin(createUserDto);
  }

  @Patch(':id')
  @IsAdministrator()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @IsAdministrator()
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.delete(id);
  }
}
