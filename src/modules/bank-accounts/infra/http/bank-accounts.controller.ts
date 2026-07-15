import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { BankAccountsService } from '../../application/bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@ApiTags('bank-accounts')
@ApiBearerAuth()
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a bank account' })
  @ApiResponse({ status: 201, description: 'Created bank account' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 403, description: 'Plan bank account limit reached' })
  create(
    @ActiveUserId() userId: string,
    @Body() createBankAccountDto: CreateBankAccountDto,
  ) {
    return this.bankAccountsService.create(userId, createBankAccountDto);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's bank accounts" })
  @ApiResponse({
    status: 200,
    description: 'List of bank accounts with computed balance',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  findAll(@ActiveUserId() userId: string) {
    return this.bankAccountsService.findAllByUserId(userId);
  }

  @Put(':bankAccountId')
  @ApiOperation({ summary: 'Update a bank account' })
  @ApiResponse({ status: 200, description: 'Updated bank account' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 404, description: 'Bank account not found' })
  update(
    @ActiveUserId() userId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ) {
    return this.bankAccountsService.update(
      userId,
      bankAccountId,
      updateBankAccountDto,
    );
  }

  @Delete(':bankAccountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a bank account' })
  @ApiResponse({ status: 204, description: 'Bank account deleted' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 404, description: 'Bank account not found' })
  remove(
    @ActiveUserId() userId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
  ) {
    return this.bankAccountsService.remove(userId, bankAccountId);
  }
}
