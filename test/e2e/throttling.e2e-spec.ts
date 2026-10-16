import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';

// Limits are read per request, so this suite can tighten them at runtime
// while the rest of the e2e suite runs with the high limits in .env.test.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  const saved = { auth: process.env.THROTTLE_AUTH_LIMIT };

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = saved.auth;
    await cleanDatabase(app);
    await app.close();
  });

  it('answers 429 with Retry-After once one IP exceeds the auth limit, without affecting other routes', async () => {
    await cleanDatabase(app);
    const { accessToken } = await signUpAndGetTokens(app);
    process.env.THROTTLE_AUTH_LIMIT = '3';

    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: 'nobody@test.com', password: 'wrong-password' });

    // The signup helper above already used one signin, so don't assume an
    // exact count: within a few attempts the bucket must close, and every
    // response before that must be the normal 401.
    const statuses: number[] = [];
    let blocked: request.Response | undefined;
    for (let i = 0; i < 5 && !blocked; i++) {
      const res = await attempt();
      if (res.status === 429) blocked = res;
      else statuses.push(res.status);
    }

    expect(blocked).toBeDefined();
    expect(statuses.length).toBeLessThanOrEqual(3);
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect(Number(blocked!.headers['retry-after'])).toBeGreaterThan(0);

    const other = await request(app.getHttpServer())
      .get('/categories')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(other.status).toBe(200);
  });
});
