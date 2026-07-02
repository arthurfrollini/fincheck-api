import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const IS_ROLES_KEY = 'roles';
export const IsAdministrator = () => SetMetadata(IS_ROLES_KEY, [Role.ADMINISTRATOR]);
