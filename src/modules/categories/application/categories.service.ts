import { Injectable } from '@nestjs/common';
import { CategoriesRepository } from '../domain/repositories/categories.repository';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepository: CategoriesRepository) {}

  findAllByUserId(userId: string) {
    return this.categoriesRepository.findAllByUserId(userId);
  }
}
