import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { UsersRepository } from '../domain/repositories/users.repository';
import { CreateUserDto } from '../infra/http/dto/create-user.dto';
import { UpdateUserDto } from '../infra/http/dto/update-user.dto';
import { MailService } from '@shared/mail/mail.service';
import { hash } from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailService: MailService,
  ) {}

  async getUserById(userId: string) {
    return this.usersRepository.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        role: true,
      },
    });
  }

  listAll() {
    return this.usersRepository.findMany();
  }

  async createByAdmin(createUserDto: CreateUserDto) {
    const { name, email, password, role } = createUserDto;

    const encryptedPassword = await hash(password, 12);

    return this.usersRepository.create({
      name,
      email,
      password: encryptedPassword,
      role,
    });
  }

  async update(userId: string, updateUserDto: UpdateUserDto) {
    const { name, email, role } = updateUserDto;

    const user = await this.usersRepository.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found.');

    return this.usersRepository.update(userId, { name, email, role });
  }

  async delete(userId: string) {
    const user = await this.usersRepository.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found.');

    await this.usersRepository.delete(userId);
  }

  async requestEmailChange(userId: string, newEmail: string) {
    const emailTaken = await this.usersRepository.findUnique({
      where: { email: newEmail },
    });

    if (emailTaken) throw new ConflictException('Email already in use.');

    const token = uuidv4();

    await this.usersRepository.update(userId, {
      pendingEmail: newEmail,
      emailToken: token,
    });

    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailService.sendEmailChangeConfirmation(
      'arthur.frollini@gmail.com',
      token,
    );
  }

  async confirmEmailChange(token: string) {
    const user = await this.usersRepository.findByEmailToken(token);

    if (!user || !user.pendingEmail) {
      throw new BadRequestException('Invalid or expired token.');
    }

    await this.usersRepository.update(user.id, {
      email: user.pendingEmail,
      pendingEmail: null,
      emailToken: null,
    });
  }
}
