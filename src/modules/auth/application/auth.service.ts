import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersRepository } from '../../users/domain/repositories/users.repository';
import { compare } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { SignUpDto } from '../infra/http/dto/sign-up.dto';
import { hash } from 'bcryptjs';
import { SignInDto } from '../infra/http/dto/sign-in.dto';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
  ) {}

  async signin(signInDto: SignInDto) {
    const { email, password } = signInDto;

    const user = await this.usersRepository.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials: email not found');
    }

    const isPasswordValid = await compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Invalid credentials: password incorrect',
      );
    }

    const accessToken = await this.generateAccessToken(user.id, user.role);

    return { accessToken };
  }

  async signup(signUpDto: SignUpDto) {
    const { name, email, password } = signUpDto;

    const emailTaken = await this.usersRepository.findUnique({
      where: { email },
    });

    if (emailTaken) {
      throw new ConflictException('This email is already in use.');
    }

    const encryptedPassword = await hash(password, 12);

    const user = await this.usersRepository.create({
      name,
      email,
      password: encryptedPassword,
      categories: {
        createMany: {
          data: [
            { name: 'Salário', icon: 'salary', type: 'INCOME' },
            { name: 'Freelance', icon: 'freelance', type: 'INCOME' },
            { name: 'Outro', icon: 'other', type: 'INCOME' },
            { name: 'Casa', icon: 'home', type: 'EXPENSE' },
            { name: 'Alimentação', icon: 'food', type: 'EXPENSE' },
            { name: 'Educação', icon: 'education', type: 'EXPENSE' },
            { name: 'Lazer', icon: 'fun', type: 'EXPENSE' },
            { name: 'Mercado', icon: 'grocery', type: 'EXPENSE' },
            { name: 'Roupas', icon: 'clothes', type: 'EXPENSE' },
            { name: 'Transporte', icon: 'transport', type: 'EXPENSE' },
            { name: 'Viagem', icon: 'travel', type: 'EXPENSE' },
            { name: 'Outro', icon: 'other', type: 'EXPENSE' },
          ],
        },
      },
    });

    const accessToken = await this.generateAccessToken(user.id, user.role);

    return { accessToken };
  }

  private async generateAccessToken(userId: string, role: Role) {
    return this.jwtService.signAsync({ sub: userId, role });
  }
}
