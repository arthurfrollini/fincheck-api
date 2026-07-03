import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from '../../application/categories.service';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.categoriesService.findAllByUserId(userId);
  }
}
