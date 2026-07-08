import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@shared/config/env';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly bucketUrl: string;

  constructor() {
    this.s3Client = new S3Client({
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });

    this.bucketName = env.awsS3BucketName;
    this.bucketUrl = `https://${this.bucketName}.s3.${env.awsRegion}.amazonaws.com`;
  }

  async generateUploadUrl(
    userId: string,
    ext: string,
  ): Promise<{ uploadUrl: string; avatarUrl: string }> {
    const key = `avatars/${userId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 300,
    });

    const avatarUrl = `${this.bucketUrl}/${key}`;

    return { uploadUrl, avatarUrl };
  }
}
