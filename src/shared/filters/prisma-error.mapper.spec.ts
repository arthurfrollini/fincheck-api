import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mapPrismaError } from './prisma-error.mapper';

function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Simulated Prisma error', {
    code,
    clientVersion: '6.19.3',
  });
}

describe('mapPrismaError', () => {
  it('maps P2002 (unique constraint) to ConflictException', () => {
    const result = mapPrismaError(makePrismaError('P2002'));
    expect(result).toBeInstanceOf(ConflictException);
  });

  it('maps P2025 (record not found) to NotFoundException', () => {
    const result = mapPrismaError(makePrismaError('P2025'));
    expect(result).toBeInstanceOf(NotFoundException);
  });

  it('maps P2003 (foreign key violation) to BadRequestException', () => {
    const result = mapPrismaError(makePrismaError('P2003'));
    expect(result).toBeInstanceOf(BadRequestException);
  });

  it('returns null for an unrecognized Prisma error code', () => {
    const result = mapPrismaError(makePrismaError('P9999'));
    expect(result).toBeNull();
  });

  it('returns null for a non-Prisma error', () => {
    const result = mapPrismaError(new Error('some other error'));
    expect(result).toBeNull();
  });

  it('returns null for a non-error value', () => {
    expect(mapPrismaError('not an error')).toBeNull();
    expect(mapPrismaError(undefined)).toBeNull();
  });
});
