import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';

describe('Categories (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    ({ accessToken } = await signUpAndGetTokens(app));
  });

  // New signups default to plan: FREE (prisma/schema.prisma:35), and
  // PLAN_LIMITS.FREE.canManageCategories === false (plan.constants.ts:11),
  // so category update/delete needs promotion to GOLD/PLATINUM first.
  async function promoteToGold(email: string): Promise<void> {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: 'GOLD' },
    });
  }

  describe('GET /categories', () => {
    it('returns seeded categories for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('returns 401 without token', async () => {
      const res = await request(app.getHttpServer()).get('/categories');
      expect(res.status).toBe(401);
    });

    it('does not return categories of another user', async () => {
      const { accessToken: otherToken } = await signUpAndGetTokens(app);
      const res = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      const myRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);

      const myIds = myRes.body.map((c: { id: string }) => c.id);
      const otherIds = res.body.map((c: { id: string }) => c.id);
      expect(myIds).not.toEqual(expect.arrayContaining(otherIds));
    });
  });

  describe('PATCH /categories/:categoryId', () => {
    it('updates own category when plan allows category management (GOLD)', async () => {
      const email = uniqueEmail('gold-patch');
      ({ accessToken } = await signUpAndGetTokens(app, email));
      await promoteToGold(email);

      const listRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);
      const categoryId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Renamed', icon: 'new-icon' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed');
      expect(res.body.icon).toBe('new-icon');
    });

    it('returns 404 when updating another user category', async () => {
      const email = uniqueEmail('gold-patch-other');
      ({ accessToken } = await signUpAndGetTokens(app, email));
      await promoteToGold(email);

      const otherEmail = uniqueEmail('gold-patch-owner');
      const { accessToken: otherToken } = await signUpAndGetTokens(
        app,
        otherEmail,
      );
      await promoteToGold(otherEmail);

      const otherListRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${otherToken}`);
      const otherCategoryId = otherListRes.body[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/categories/${otherCategoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Hijacked' });

      expect(res.status).toBe(404);
    });

    it('returns 403 for FREE-plan user (canManageCategories: false)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);
      const categoryId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Should Not Work' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /categories/:categoryId', () => {
    it('deletes own category when plan allows category management (GOLD)', async () => {
      const email = uniqueEmail('gold-delete');
      ({ accessToken } = await signUpAndGetTokens(app, email));
      await promoteToGold(email);

      const listRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);
      const categoryId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(204);
    });

    it('returns 404 when deleting another user category', async () => {
      const email = uniqueEmail('gold-delete-other');
      ({ accessToken } = await signUpAndGetTokens(app, email));
      await promoteToGold(email);

      const otherEmail = uniqueEmail('gold-delete-owner');
      const { accessToken: otherToken } = await signUpAndGetTokens(
        app,
        otherEmail,
      );
      await promoteToGold(otherEmail);

      const otherListRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${otherToken}`);
      const otherCategoryId = otherListRes.body[0].id;

      const res = await request(app.getHttpServer())
        .delete(`/categories/${otherCategoryId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 403 for FREE-plan user (canManageCategories: false)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);
      const categoryId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });
  });
});
