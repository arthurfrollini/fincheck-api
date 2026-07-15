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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsAdministrator } from '@shared/decorators/roles.decorator';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { isPublic } from '@shared/decorators/public.decorator';
import { UsersService } from '../../application/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('/me')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  me(@ActiveUserId() userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Get('/me/avatar-upload-url')
  @ApiOperation({ summary: 'Get a presigned S3 URL to upload an avatar' })
  @ApiResponse({ status: 200, description: 'Returns uploadUrl and avatarUrl' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  getAvatarUploadUrl(
    @ActiveUserId() userId: string,
    @Query('ext') ext: string,
  ) {
    return this.usersService.getAvatarUploadUrl(userId, ext);
  }

  @Patch('/me')
  @ApiOperation({ summary: "Update the current user's name/avatar" })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  updateMe(@ActiveUserId() userId: string, @Body() updateMeDto: UpdateMeDto) {
    return this.usersService.updateMe(userId, updateMeDto);
  }

  @Patch('/me/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request an email change — sends a confirmation link' })
  @ApiResponse({ status: 204, description: 'Confirmation email sent' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
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
  @ApiOperation({ summary: 'Confirm a pending email change via token' })
  @ApiResponse({ status: 204, description: 'Email changed' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  confirmEmailChange(@Query('token') token: string) {
    return this.usersService.confirmEmailChange(token);
  }

  @Get()
  @IsAdministrator()
  @ApiOperation({ summary: '[Admin] List all users' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @ApiResponse({ status: 403, description: 'Requires ADMINISTRATOR role' })
  listAll() {
    return this.usersService.listAll();
  }

  @Post()
  @IsAdministrator()
  @ApiOperation({ summary: '[Admin] Create a user directly' })
  @ApiResponse({ status: 201, description: 'Created user' })
  @ApiResponse({ status: 403, description: 'Requires ADMINISTRATOR role' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createByAdmin(createUserDto);
  }

  @Patch(':id')
  @IsAdministrator()
  @ApiOperation({ summary: '[Admin] Update any user by id' })
  @ApiResponse({ status: 200, description: 'Updated user' })
  @ApiResponse({ status: 403, description: 'Requires ADMINISTRATOR role' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @IsAdministrator()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Delete any user by id' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 403, description: 'Requires ADMINISTRATOR role' })
  @ApiResponse({ status: 404, description: 'User not found' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.delete(id);
  }
}
