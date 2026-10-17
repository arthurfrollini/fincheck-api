import 'dotenv/config';
import './tracing';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Without this, Nest never fires onModuleDestroy/onApplicationShutdown on
  // SIGTERM/SIGINT — PrismaService wouldn't disconnect and the BullMQ worker
  // wouldn't close gracefully on deploy/restart (an in-flight job would stall
  // until the stalled-checker recovers it after the app comes back).
  app.enableShutdownHooks();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: '*' });

  const config = new DocumentBuilder()
    .setTitle('Fincheck API')
    .setDescription(
      'REST API for a personal finance management app. Users track bank accounts and transactions, organized by category, with plan-based feature limits enforced via Stripe subscriptions.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('reference', app, document, {
    jsonDocumentUrl: 'reference-json',
    swaggerUiEnabled: false,
  });

  app.use(
    '/reference',
    apiReference({
      content: document,
    }),
  );

  // Behind a hosting proxy every request comes from the proxy's address;
  // trusting it makes req.ip (the rate-limit key) the real client IP.
  // TRUST_PROXY is the number of proxy hops (usually 1), or a setting
  // Express accepts like 'loopback'.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  }

  // Hosting platforms assign the port through PORT.
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(
    `INFO: API Reference available at http://localhost:${port}/reference`,
  );
}

void bootstrap();
