jest.mock('@shared/config/env', () => ({
  env: {
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BillingController } from './billing.controller';
import { BillingEnabledGuard } from './billing-enabled.guard';

describe('BillingEnabledGuard', () => {
  const saved = process.env.BILLING_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = saved;
  });

  it.each([undefined, 'true'])(
    'allows billing routes when BILLING_ENABLED is %s',
    (value) => {
      if (value === undefined) delete process.env.BILLING_ENABLED;
      else process.env.BILLING_ENABLED = value;
      expect(new BillingEnabledGuard().canActivate()).toBe(true);
    },
  );

  it('answers 404 when BILLING_ENABLED=false, as if the route did not exist', () => {
    process.env.BILLING_ENABLED = 'false';
    expect(() => new BillingEnabledGuard().canActivate()).toThrow(
      NotFoundException,
    );
  });

  it.each([
    'createSetupIntent',
    'createSubscription',
    'changePlan',
    'cancelSubscription',
  ])('guards %s', (method) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      BillingController.prototype[method as keyof BillingController],
    ) as unknown[];
    expect(guards).toContain(BillingEnabledGuard);
  });

  it('leaves the Stripe webhook unguarded so plan changes keep syncing', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      Object.getOwnPropertyDescriptor(
        BillingController.prototype,
        'handleWebhook',
      )?.value as object,
    ) as unknown[] | undefined;
    expect(guards ?? []).not.toContain(BillingEnabledGuard);
  });
});
