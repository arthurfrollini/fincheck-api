import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from '@modules/auth/auth.guard';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { DatabaseModule } from '@shared/database/database.module';
import { MailModule } from '@shared/mail/mail.module';
import { StorageModule } from '@shared/storage/storage.module';
import { RolesGuard } from '@shared/guards/roles.guard';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { PlanModule } from '@shared/plan/plan.module';
import { BillingModule } from '@shared/billing/billing.module';

@Module({
  imports: [
    LoggerModule.forRoot(),
    UsersModule,
    DatabaseModule,
    AuthModule,
    MailModule,
    StorageModule,
    CategoriesModule,
    BankAccountsModule,
    TransactionsModule,
    PlanModule,
    BillingModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
