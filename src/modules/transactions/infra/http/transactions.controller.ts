import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Put,
  Param,
  ParseUUIDPipe,
  Query,
  ParseIntPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { TransactionsService } from '@modules/transactions/application/transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { TransactionType } from '@modules/transactions/entities/Transaction';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    return this.transactionsService.create(userId, createTransactionDto);
  }

  @Get()
  findAll(
    @ActiveUserId() userId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('bankAccountId', new ParseUUIDPipe({ optional: true }))
    bankAccountId?: string,
    @Query('type', new ParseEnumPipe(TransactionType, { optional: true }))
    type?: TransactionType,
  ) {
    return this.transactionsService.findAllByUserId(userId, {
      month,
      year,
      bankAccountId,
      type,
    });
  }

  @Put(':transactionId')
  update(
    @ActiveUserId() userId: string,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(
      userId,
      transactionId,
      updateTransactionDto,
    );
  }

  @Delete(':transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @ActiveUserId() userId: string,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
  ) {
    return this.transactionsService.remove(userId, transactionId);
  }
}
