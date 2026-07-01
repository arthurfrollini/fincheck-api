import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../domain/repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  getUserById(userId: string) {
    return this.usersRepository.findUnique({ id: userId });
  }
}
