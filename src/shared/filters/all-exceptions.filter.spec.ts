import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { Prisma } from '@prisma/client';

function makeMockHost(overrides: { url?: string; method?: string } = {}) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = {
    url: overrides.url ?? '/test',
    method: overrides.method ?? 'GET',
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let mockLogger: jest.Mocked<Pick<PinoLogger, 'error' | 'warn' | 'info'>>;
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    filter = new AllExceptionsFilter(mockLogger as unknown as PinoLogger);
  });

  it('logs an unrecognized error at error level with stack trace and errorId, returns 500', () => {
    const { host, status, json } = makeMockHost();
    const unexpected = new Error('boom');

    filter.catch(unexpected, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        errorId: expect.stringMatching(/^[0-9a-f-]{8}$/),
      }),
    );
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [logPayload] = mockLogger.error.mock.calls[0] as [
      { err: unknown; errorId: string },
    ];
    expect(logPayload.err).toBe(unexpected);
    expect(logPayload.errorId).toEqual(expect.stringMatching(/^[0-9a-f-]{8}$/));
  });

  it('passes through an existing HttpException unchanged, no errorId, logs at info level', () => {
    const { host, status, json } = makeMockHost();
    const notFound = new NotFoundException('Bank account not found.');

    filter.catch(notFound, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bank account not found.' }),
    );
    const [body] = json.mock.calls[0];
    expect(body).not.toHaveProperty?.('errorId');
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('translates a Prisma P2002 error to 409 via mapPrismaError', () => {
    const { host, status } = makeMockHost();
    const prismaError = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs 401/403 at warn level, not info', () => {
    const { host } = makeMockHost();
    const { UnauthorizedException } = jest.requireActual('@nestjs/common');

    filter.catch(new UnauthorizedException(), host);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
