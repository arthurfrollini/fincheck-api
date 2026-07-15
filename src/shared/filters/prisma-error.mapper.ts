import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function mapPrismaError(error: unknown): HttpException | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  switch (error.code) {
    case 'P2002':
      return new ConflictException('A record with this value already exists.');
    case 'P2025':
      return new NotFoundException('Record not found.');
    case 'P2003':
      return new BadRequestException('Referenced record does not exist.');
    default:
      return null;
  }
}
