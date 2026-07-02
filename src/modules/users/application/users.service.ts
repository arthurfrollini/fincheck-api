import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from '../domain/repositories/users.repository';
import { CreateUserDto } from '../infra/http/dto/create-user.dto';
import { UpdateUserDto } from '../infra/http/dto/update-user.dto';
import { hash } from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

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
}
