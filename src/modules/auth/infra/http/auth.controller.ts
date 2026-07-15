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
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { isPublic } from '@shared/decorators/public.decorator';
import { AuthService } from '../../application/auth.service';
import { GoogleProfile } from './strategies/google.strategy';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@isPublic()
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/signin')
  @ApiOperation({
    summary: '/signin',
    description: 'Sign in with email and password',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns accessToken and refreshToken',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  signin(@Body() signInDto: SignInDto) {
    return this.authService.signin(signInDto);
  }

  @Post('/signup')
  @ApiOperation({ summary: '/signup', description: 'Create a new account' })
  @ApiResponse({
    status: 201,
    description: 'Returns accessToken and refreshToken',
  })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  signup(@Body() signUpDto: SignUpDto) {
    return this.authService.signup(signUpDto);
  }

  @Post('/refresh')
  @ApiOperation({
    summary: '/refresh',
    description: 'Exchange a refresh token for a new token pair',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns a new accessToken and refreshToken',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  refresh(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.refresh(refreshToken);
  }

  @Post('/signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '/signout',
    description: 'Invalidate a refresh token',
  })
  @ApiResponse({ status: 204, description: 'Refresh token invalidated' })
  signout(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.signout(refreshToken);
  }

  @Get('/google')
  @UseGuards(AuthGuard('google'))
  @ApiExcludeEndpoint()
  googleAuth() {}

  @Get('/google/callback')
  @UseGuards(AuthGuard('google'))
  @Redirect()
  @ApiExcludeEndpoint()
  async googleCallback(@Req() request: { user: GoogleProfile }) {
    const { accessToken, refreshToken } = await this.authService.googleAuth(
      request.user,
    );
    return {
      url: `http://localhost:3001?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    };
  }
}
