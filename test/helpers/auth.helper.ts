import request from 'supertest';
import { authTokens, parseBody } from './body';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${++counter}@test.com`;
}

export async function signUpAndGetTokens(
  app: INestApplication<App>,
  email = uniqueEmail(),
  password = 'Test@1234',
  name = 'Test User',
): Promise<AuthTokens> {
  const signUpRes = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name, email, password });

  if (signUpRes.status !== 201) {
    throw new Error(
      `signUpAndGetTokens: /auth/signup failed with status ${signUpRes.status}. Body: ${JSON.stringify(signUpRes.body)}`,
    );
  }

  const res = await request(app.getHttpServer())
    .post('/auth/signin')
    .send({ email, password });

  return parseBody(res, authTokens);
}
