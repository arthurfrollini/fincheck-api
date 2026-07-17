import { Provider } from '@nestjs/common';
import Stripe from 'stripe';
import { env } from '@shared/config/env';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

export const stripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: () => new Stripe(env.stripeSecretKey),
};
