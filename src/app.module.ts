import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '@modules/auth/auth.guard';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { DatabaseModule } from '@shared/database/database.module';
import { MailModule } from '@shared/mail/mail.module';
import { RolesGuard } from '@shared/guards/roles.guard';

@Module({
  imports: [UsersModule, DatabaseModule, AuthModule, MailModule, CategoriesModule],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
