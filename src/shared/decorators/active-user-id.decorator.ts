import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ActiveUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ userId: string }>();
    return request.userId;
  },
);
