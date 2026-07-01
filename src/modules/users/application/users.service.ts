import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../domain/repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getUserById(userId: string) {
    const user = await this.usersRepository.findUnique({ id: userId });

    if (!user) return null;

    const { password: _password, ...rest } = user;

    return rest;
  }

  listAll() {
    return this.usersRepository.findMany();
  }
}
