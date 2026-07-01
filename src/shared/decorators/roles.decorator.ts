import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const IS_ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(IS_ROLES_KEY, roles);
