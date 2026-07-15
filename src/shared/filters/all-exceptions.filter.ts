import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { mapPrismaError } from './prisma-error.mapper';
import { mapStripeError } from './stripe-error.mapper';

interface MinimalRequest {
  url: string;
  method: string;
}

interface MinimalResponse {
  status: (code: number) => { json: (body: unknown) => void };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<MinimalResponse>();
    const request = ctx.getRequest<MinimalRequest>();

    const translated =
      mapPrismaError(exception) ?? mapStripeError(exception) ?? exception;

    const isHttpException = translated instanceof HttpException;
    const status = isHttpException
      ? translated.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      const errorId = randomUUID().slice(0, 8);
      this.logger.error(
        {
          err: exception,
          errorId,
          path: request.url,
          method: request.method,
        },
        'Unhandled exception',
      );
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
        errorId,
      });
      return;
    }

    const body = isHttpException
      ? translated.getResponse()
      : { statusCode: status, message: 'Unknown error' };

    const logPayload = { path: request.url, method: request.method, status };
    const logMessage =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as Record<string, unknown>).message)
        : 'Request rejected';

    if (status === 401 || status === 403) {
      this.logger.warn(logPayload, logMessage);
    } else {
      this.logger.info(logPayload, logMessage);
    }

    response.status(status).json(body);
  }
}
