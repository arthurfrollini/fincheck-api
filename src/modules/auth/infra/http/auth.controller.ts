import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { isPublic } from '@shared/decorators/public.decorator';
import { AuthService } from '../../application/auth.service';
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
}
