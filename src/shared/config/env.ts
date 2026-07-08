import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, validateSync } from 'class-validator';

class Env {
  @IsString()
  @IsNotEmpty()
  jwtSecret: string;

  @IsString()
  @IsNotEmpty()
  databaseURL: string;

  @IsString()
  @IsNotEmpty()
  resendApiKey: string;

  @IsString()
  @IsNotEmpty()
  resendFromEmail: string;

  @IsString()
  @IsNotEmpty()
  googleClientId: string;

  @IsString()
  @IsNotEmpty()
  googleClientSecret: string;

  @IsString()
  @IsNotEmpty()
  googleCallbackUrl: string;

  @IsString()
  @IsNotEmpty()
  awsRegion: string;

  @IsString()
  @IsNotEmpty()
  awsAccessKeyId: string;

  @IsString()
  @IsNotEmpty()
  awsSecretAccessKey: string;

  @IsString()
  @IsNotEmpty()
  awsS3BucketName: string;
}

export const env: Env = plainToInstance(Env, {
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
});

const errors = validateSync(env);

if (errors.length > 0) {
  throw new Error(JSON.stringify(errors, null, 2));
}
