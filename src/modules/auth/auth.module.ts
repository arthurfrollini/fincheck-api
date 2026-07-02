import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '@shared/config/env';
import { UsersModule } from '@modules/users/users.module';
import { AuthService } from './application/auth.service';
import { AuthController } from './infra/http/auth.controller';
import { RefreshTokensRepository } from './domain/repositories/refresh-tokens.repository';
import { RefreshTokensPrismaRepository } from './infra/database/refresh-tokens.prisma.repository';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.jwtSecret,
      signOptions: { expiresIn: '14m' },
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: RefreshTokensRepository,
      useClass: RefreshTokensPrismaRepository,
    },
  ],
})
export class AuthModule {}
