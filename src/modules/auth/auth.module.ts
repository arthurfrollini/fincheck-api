import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { env } from '@shared/config/env';
import { UsersModule } from '@modules/users/users.module';
import { AuthService } from './application/auth.service';
import { RefreshTokensCleanupJob } from './application/refresh-tokens-cleanup.job';
import { AuthController } from './infra/http/auth.controller';
import { GoogleStrategy } from './infra/http/strategies/google.strategy';
import { RefreshTokensRepository } from './domain/repositories/refresh-tokens.repository';
import { RefreshTokensPrismaRepository } from './infra/database/refresh-tokens.prisma.repository';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.jwtSecret,
      signOptions: { expiresIn: '14d' },
    }),
    PassportModule,
    ScheduleModule.forRoot(),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleStrategy,
    RefreshTokensCleanupJob,
    {
      provide: RefreshTokensRepository,
      useClass: RefreshTokensPrismaRepository,
    },
  ],
})
export class AuthModule {}
