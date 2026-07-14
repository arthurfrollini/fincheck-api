import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

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

  await app.listen(3000);
}

void bootstrap();
