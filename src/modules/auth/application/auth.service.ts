import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { Plan } from '@modules/users/entities/User';
import { MailService } from '@shared/mail/mail.service';
import { SignUpDto } from '../infra/http/dto/sign-up.dto';
import { SignInDto } from '../infra/http/dto/sign-in.dto';
import { RefreshTokensRepository } from '../domain/repositories/refresh-tokens.repository';
import { GoogleProfile } from '../infra/http/strategies/google.strategy';

const DEFAULT_CATEGORIES = [
  { name: 'Salário', icon: 'salary', type: 'INCOME' as const },
  { name: 'Freelance', icon: 'freelance', type: 'INCOME' as const },
  { name: 'Outro', icon: 'other', type: 'INCOME' as const },
  { name: 'Casa', icon: 'home', type: 'EXPENSE' as const },
  { name: 'Alimentação', icon: 'food', type: 'EXPENSE' as const },
  { name: 'Educação', icon: 'education', type: 'EXPENSE' as const },
  { name: 'Lazer', icon: 'fun', type: 'EXPENSE' as const },
  { name: 'Mercado', icon: 'grocery', type: 'EXPENSE' as const },
  { name: 'Roupas', icon: 'clothes', type: 'EXPENSE' as const },
  { name: 'Transporte', icon: 'transport', type: 'EXPENSE' as const },
  { name: 'Viagem', icon: 'travel', type: 'EXPENSE' as const },
  { name: 'Outro', icon: 'other', type: 'EXPENSE' as const },
];

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async signin(signInDto: SignInDto) {
    const { email, password } = signInDto;

    const user = await this.usersRepository.findByEmail(email);

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isPasswordValid = await compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.generateTokens(user.id, user.role);
  }

  async signup(signUpDto: SignUpDto) {
    const { name, email, password, plan = Plan.FREE } = signUpDto;

    if (plan !== Plan.FREE) {
      throw new BadRequestException(
        'Plan upgrade requires Stripe integration. Please sign up with the FREE plan.',
      );
    }

    const emailTaken = await this.usersRepository.findByEmail(email);

    if (emailTaken) {
      throw new ConflictException('This email is already in use.');
    }

    const encryptedPassword = await hash(password, 12);

    const user = await this.usersRepository.create({
      name,
      email,
      password: encryptedPassword,
      categories: DEFAULT_CATEGORIES,
    });

    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailService.sendWelcome('arthur.frollini@gmail.com', user.name);

    return this.generateTokens(user.id, user.role);
  }

  async refresh(token: string) {
    const refreshToken = await this.refreshTokensRepository.findByToken(token);

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    if (refreshToken.expiresAt < new Date()) {
      await this.refreshTokensRepository.deleteByToken(token);
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.usersRepository.findById(refreshToken.userId);

    if (!user) {
      throw new UnauthorizedException();
    }

    await this.refreshTokensRepository.deleteByToken(token);

    return this.generateTokens(user.id, user.role);
  }

  async signout(token: string) {
    await this.refreshTokensRepository.deleteByToken(token);
  }

  async googleAuth(profile: GoogleProfile) {
    const { googleId, email, name } = profile;

    let user = await this.usersRepository.findByGoogleId(googleId);

    if (!user) {
      const userWithEmail = await this.usersRepository.findByEmail(email);

      if (userWithEmail) {
        user = await this.usersRepository.update(userWithEmail.id, {
          googleId,
        });
      } else {
        user = await this.usersRepository.create({
          name,
          email,
          googleId,
          categories: DEFAULT_CATEGORIES,
        });

        // TODO: trocar 'arthur.frollini@gmail.com' por email quando houver domínio verificado no Resend
        await this.mailService.sendWelcome('arthur.frollini@gmail.com', name);
      }
    }

    return this.generateTokens(user.id, user.role);
  }

  private async generateTokens(userId: string, role: string) {
    const accessToken = await this.jwtService.signAsync({ sub: userId, role });

    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await this.refreshTokensRepository.create(userId, refreshToken, expiresAt);

    return { accessToken, refreshToken };
  }
}
