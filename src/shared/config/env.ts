import { z } from 'zod';

const required = z.string().min(1);

const envSchema = z.object({
  jwtSecret: required,
  databaseURL: required,
  resendApiKey: required,
  resendFromEmail: required,
  googleClientId: required,
  googleClientSecret: required,
  googleCallbackUrl: required,
  awsRegion: required,
  awsAccessKeyId: required,
  awsSecretAccessKey: required,
  awsS3BucketName: required,
  stripeSecretKey: required,
  stripeWebhookSecret: required,
  stripePriceGold: required,
  stripePricePlatinum: required,
  redisHost: required,
  redisPort: required,
  anthropicApiKey: required,
});

const parsed = envSchema.safeParse({
  jwtSecret: process.env.JWT_SECRET,
  databaseURL: process.env.DATABASE_URL,
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsS3BucketName: process.env.AWS_S3_BUCKET_NAME,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripePriceGold: process.env.STRIPE_PRICE_GOLD,
  stripePricePlatinum: process.env.STRIPE_PRICE_PLATINUM,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const env = parsed.data;
