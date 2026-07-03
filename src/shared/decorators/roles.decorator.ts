import { SetMetadata } from '@nestjs/common';
import { Role } from '@modules/users/entities/User';

export const IS_ROLES_KEY = 'roles';
export const IsAdministrator = () => SetMetadata(IS_ROLES_KEY, [Role.ADMINISTRATOR]);
