import request from 'supertest';
import { INestApplication } from '@nestjs/common';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${++counter}@test.com`;
}

export async function signUpAndGetTokens(
  app: INestApplication,
  email = uniqueEmail(),
  password = 'Test@1234',
  name = 'Test User',
): Promise<AuthTokens> {
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name, email, password });

  const res = await request(app.getHttpServer())
    .post('/auth/signin')
    .send({ email, password });

  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}
