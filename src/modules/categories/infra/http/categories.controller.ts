import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CategoriesService } from '@modules/categories/application/categories.service';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's categories" })
  @ApiResponse({ status: 200, description: 'List of categories' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  findAll(@ActiveUserId() userId: string) {
    return this.categoriesService.findAllByUserId(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a category' })
  @ApiResponse({ status: 201, description: 'Created category' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 403, description: 'Requires GOLD or PLATINUM plan' })
  create(
    @ActiveUserId() userId: string,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(userId, createCategoryDto);
  }

  @Patch(':categoryId')
  @ApiOperation({ summary: 'Update a category' })
  @ApiResponse({ status: 200, description: 'Updated category' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 403, description: 'Requires GOLD or PLATINUM plan' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  update(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(userId, categoryId, updateCategoryDto);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 403, description: 'Requires GOLD or PLATINUM plan' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  remove(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.categoriesService.remove(userId, categoryId);
  }
}
