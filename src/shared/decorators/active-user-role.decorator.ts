import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ActiveUserRole = createParamDecorator(
  (_data, ctx: ExecutionContext): Role => {
    const request = ctx.switchToHttp().getRequest<{ userRole: Role }>();
    return request.userRole;
  },
);
