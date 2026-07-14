jest.mock('@shared/config/env', () => ({
  env: {
    googleClientId: 'client-id-fake',
    googleClientSecret: 'client-secret-fake',
    googleCallbackUrl: 'http://localhost:3000/auth/google/callback',
  },
}));

import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  it('maps the passport profile into a GoogleProfile and calls done with it', () => {
    const strategy = new GoogleStrategy();
    const done = jest.fn();

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
});
