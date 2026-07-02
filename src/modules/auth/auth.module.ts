import { Module } from '@nestjs/common';
import { AuthService } from './application/auth.service';
import { AuthController } from './infra/http/auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { env } from '@shared/config/env';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
