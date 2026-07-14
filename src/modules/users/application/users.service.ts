import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { hash } from 'bcryptjs';
import { UsersRepository } from '../domain/repositories/users.repository';
import { MailService } from '@shared/mail/mail.service';
import { StorageService } from '@shared/storage/storage.service';
import { CreateUserDto } from '../infra/http/dto/create-user.dto';
import { UpdateUserDto } from '../infra/http/dto/update-user.dto';
import { type UserEntity } from '../entities/User';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}

  async getUserById(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) return null;
    return {
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      avatarUrl: user.avatarUrl,
    };
  }

  getAvatarUploadUrl(userId: string, ext: string) {
    return this.storageService.generateUploadUrl(userId, ext);
  }

  private toAdminSafeUser(user: UserEntity) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      avatarUrl: user.avatarUrl,
    };
  }

  async listAll() {
    const users = await this.usersRepository.findMany();
    return users.map((user) => this.toAdminSafeUser(user));
  }

  async createByAdmin(createUserDto: CreateUserDto) {
    const { name, email, password, role } = createUserDto;
    const encryptedPassword = await hash(password, 12);
    const created = await this.usersRepository.create({
      name,
      email,
      password: encryptedPassword,
      role,
    });
    return this.toAdminSafeUser(created);
  }

  async updateMe(userId: string, dto: { name?: string; avatarUrl?: string }) {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    const updated = await this.usersRepository.update(userId, {
      name: dto.name,
      avatarUrl: dto.avatarUrl,
    });
    return {
      name: updated.name,
      email: updated.email,
      role: updated.role,
      plan: updated.plan,
      avatarUrl: updated.avatarUrl,
    };
  }

  async update(userId: string, updateUserDto: UpdateUserDto) {
    const { name, email, role } = updateUserDto;
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    const updated = await this.usersRepository.update(userId, {
      name,
      email,
      role,
    });
    return this.toAdminSafeUser(updated);
  }

  async delete(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    await this.usersRepository.delete(userId);
  }

  async requestEmailChange(userId: string, newEmail: string) {
    const emailTaken = await this.usersRepository.findByEmail(newEmail);
    if (emailTaken) throw new ConflictException('Email already in use.');

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

    await this.usersRepository.update(userId, {
      pendingEmail: newEmail,
      emailToken: token,
      emailTokenExpiresAt: expiresAt,
    });

    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailService.sendEmailChangeConfirmation(
      'arthur.frollini@gmail.com',
      token,
    );
  }

  async confirmEmailChange(token: string) {
    const user = await this.usersRepository.findByEmailToken(token);

    if (!user || !user.pendingEmail || !user.emailTokenExpiresAt) {
      throw new BadRequestException('Invalid or expired token.');
    }

    if (user.emailTokenExpiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token.');
    }

    await this.usersRepository.update(user.id, {
      email: user.pendingEmail,
      pendingEmail: null,
      emailToken: null,
      emailTokenExpiresAt: null,
    });
  }
}
