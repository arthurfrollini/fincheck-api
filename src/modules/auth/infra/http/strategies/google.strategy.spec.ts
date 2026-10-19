import { type VerifyCallback } from 'passport-google-oauth20';
jest.mock('@shared/config/env', () => ({
  env: {
    googleClientId: 'client-id-fake',
    googleClientSecret: 'client-secret-fake',
    googleCallbackUrl: 'http://localhost:3000/auth/google/callback',
  },
}));

import { UnauthorizedException } from '@nestjs/common';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  it('maps the passport profile into a GoogleProfile and calls done with it', () => {
    const strategy = new GoogleStrategy();
    const done = jest.fn<void, Parameters<VerifyCallback>>();

    strategy.validate(
      'access-token',
      'refresh-token',
      {
        id: 'google-123',
        emails: [{ value: 'user@example.com' }],
        displayName: 'Test User',
      },
      done,
    );

    expect(done).toHaveBeenCalledWith(null, {
      googleId: 'google-123',
      email: 'user@example.com',
      name: 'Test User',
    });
  });

  it('rejects a Google account that shares no email', () => {
    const strategy = new GoogleStrategy();
    const done = jest.fn<void, Parameters<VerifyCallback>>();

    strategy.validate(
      'access-token',
      'refresh-token',
      { id: 'google-123', emails: [], displayName: 'Test User' },
      done,
    );

    expect(done).toHaveBeenCalledWith(expect.any(UnauthorizedException), false);
  });
});
