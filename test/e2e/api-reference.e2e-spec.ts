import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';

describe('API Reference (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the Scalar reference UI at /reference', async () => {
    const res = await request(app.getHttpServer()).get('/reference');
    expect(res.status).toBe(200);
  });

  it('serves a valid OpenAPI document at /reference-json', async () => {
    const res = await request(app.getHttpServer()).get('/reference-json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body.info.title).toBe('Fincheck API');
  });
});
