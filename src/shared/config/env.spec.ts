const required = {
  JWT_SECRET: 'jwt',
  DATABASE_URL: 'postgresql://test',
  RESEND_API_KEY: 'resend',
  RESEND_FROM_EMAIL: 'from@test.com',
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost/callback',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'aws-key',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_S3_BUCKET_NAME: 'bucket',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  STRIPE_PRICE_GOLD: 'price_gold',
  STRIPE_PRICE_PLATINUM: 'price_platinum',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  ANTHROPIC_API_KEY: 'sk-ant',
};

describe('env', () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
  });

  const load = (vars: Record<string, string | undefined>) => {
    process.env = { ...vars };
    let loaded: unknown;
    jest.isolateModules(() => {
      loaded = jest.requireActual<typeof import('./env')>('./env').env;
    });
    return loaded;
  };

  it('maps every variable onto its config key', () => {
    expect(load(required)).toEqual({
      jwtSecret: 'jwt',
      databaseURL: 'postgresql://test',
      resendApiKey: 'resend',
      resendFromEmail: 'from@test.com',
      googleClientId: 'google-id',
      googleClientSecret: 'google-secret',
      googleCallbackUrl: 'http://localhost/callback',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'aws-key',
      awsSecretAccessKey: 'aws-secret',
      awsS3BucketName: 'bucket',
      stripeSecretKey: 'sk_test',
      stripeWebhookSecret: 'whsec',
      stripePriceGold: 'price_gold',
      stripePricePlatinum: 'price_platinum',
      redisHost: 'localhost',
      redisPort: '6379',
      anthropicApiKey: 'sk-ant',
    });
  });

  it('refuses to start when a variable is missing', () => {
    expect(() => load({ ...required, JWT_SECRET: undefined })).toThrow(
      /jwtSecret/,
    );
  });

  it('refuses to start when a variable is empty', () => {
    expect(() => load({ ...required, ANTHROPIC_API_KEY: '' })).toThrow(
      /anthropicApiKey/,
    );
  });
});
