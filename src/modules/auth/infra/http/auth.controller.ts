import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isPublic } from '@shared/decorators/public.decorator';
import { AuthService } from '../../application/auth.service';
import { GoogleProfile } from './strategies/google.strategy';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@isPublic()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/signin')
  signin(@Body() signInDto: SignInDto) {
    return this.authService.signin(signInDto);
  }

  @Post('/signup')
  signup(@Body() signUpDto: SignUpDto) {
    return this.authService.signup(signUpDto);
  }

  @Post('/refresh')
  refresh(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.refresh(refreshToken);
  }

  @Post('/signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  signout(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.signout(refreshToken);
  }

  @Get('/google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {}

  @Get('/google/callback')
  @UseGuards(AuthGuard('google'))
  @Redirect()
  async googleCallback(@Req() request: { user: GoogleProfile }) {
    const { accessToken, refreshToken } = await this.authService.googleAuth(
      request.user,
    );
    return {
      url: `http://localhost:3001?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    };
  }
}
