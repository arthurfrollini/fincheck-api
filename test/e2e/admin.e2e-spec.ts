import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';

describe('Admin routes (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  async function signUpAdmin(email = uniqueEmail('admin')) {
    const password = 'Test@1234';
    await signUpAndGetTokens(app, email, password);

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMINISTRATOR' },
    });

    // re-signin so the JWT carries the freshly-promoted role
    const signinRes = await request(app.getHttpServer())
      .post('/auth/signin')
      .send({ email, password });

    return {
      accessToken: signinRes.body.accessToken as string,
      userId: user.id as string,
    };
  }

  describe('GET /users', () => {
    it('admin token returns 200 with array of users', async () => {
      const { accessToken, userId } = await signUpAdmin();

      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((u: { id: string }) => u.id === userId)).toBe(
        true,
      );
    });

    it('non-admin token returns 403', async () => {
      const { accessToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });

    it('no token returns 401', async () => {
      const res = await request(app.getHttpServer()).get('/users');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /users', () => {
    it('admin token creates a user and returns 201', async () => {
      const { accessToken } = await signUpAdmin();
      const newEmail = uniqueEmail('created');

      const res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Created User',
          email: newEmail,
          password: 'Test@1234',
          role: 'USER',
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe(newEmail);
      expect(res.body.name).toBe('Created User');
    });

    it('non-admin token returns 403', async () => {
      const { accessToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Should Not Create',
          email: uniqueEmail('blocked'),
          password: 'Test@1234',
          role: 'USER',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /users/:id', () => {
    it('admin token updates target user and returns 200', async () => {
      const { accessToken } = await signUpAdmin();
      const targetEmail = uniqueEmail('target');
      await signUpAndGetTokens(app, targetEmail);
      const prisma = app.get(PrismaService);
      const target = await prisma.user.findUniqueOrThrow({
        where: { email: targetEmail },
      });

      const res = await request(app.getHttpServer())
        .patch(`/users/${target.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('admin token with unknown id returns 404', async () => {
      const { accessToken } = await signUpAdmin();

      const res = await request(app.getHttpServer())
        .patch('/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Nobody' });

      expect(res.status).toBe(404);
    });

    it('non-admin token returns 403', async () => {
      const { accessToken } = await signUpAndGetTokens(app);
      const targetEmail = uniqueEmail('target2');
      await signUpAndGetTokens(app, targetEmail);
      const prisma = app.get(PrismaService);
      const target = await prisma.user.findUniqueOrThrow({
        where: { email: targetEmail },
      });

      const res = await request(app.getHttpServer())
        .patch(`/users/${target.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Nope' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /users/:id', () => {
    it('admin token deletes target user and returns 204', async () => {
      const { accessToken } = await signUpAdmin();
      const targetEmail = uniqueEmail('delete-me');
      await signUpAndGetTokens(app, targetEmail);
      const prisma = app.get(PrismaService);
      const target = await prisma.user.findUniqueOrThrow({
        where: { email: targetEmail },
      });

      const res = await request(app.getHttpServer())
        .delete(`/users/${target.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(204);

      const listRes = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(
        listRes.body.some((u: { id: string }) => u.id === target.id),
      ).toBe(false);
    });

    it('admin token with unknown id returns 404', async () => {
      const { accessToken } = await signUpAdmin();

      const res = await request(app.getHttpServer())
        .delete('/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });

    it('non-admin token returns 403', async () => {
      const { accessToken } = await signUpAndGetTokens(app);
      const targetEmail = uniqueEmail('delete-blocked');
      await signUpAndGetTokens(app, targetEmail);
      const prisma = app.get(PrismaService);
      const target = await prisma.user.findUniqueOrThrow({
        where: { email: targetEmail },
      });

      const res = await request(app.getHttpServer())
        .delete(`/users/${target.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });
  });
});
