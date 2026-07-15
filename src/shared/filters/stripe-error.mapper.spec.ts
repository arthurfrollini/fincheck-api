import { BadGatewayException, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { mapStripeError } from './stripe-error.mapper';

describe('mapStripeError', () => {
  it("maps StripeCardError to BadRequestException using Stripe's own message", () => {
    const cardError = new Stripe.errors.StripeCardError({
      message: 'Your card was declined.',
      type: 'StripeCardError',
    } as any);

    const result = mapStripeError(cardError);

    expect(result).toBeInstanceOf(BadRequestException);
    expect(result?.getResponse()).toEqual(
      expect.objectContaining({ message: 'Your card was declined.' }),
    );
  });

  it('maps StripeAPIError to BadGatewayException with a generic message', () => {
    const apiError = new Stripe.errors.StripeAPIError({
      message: 'Some internal Stripe detail that should not leak.',
      type: 'StripeAPIError',
    } as any);

    const result = mapStripeError(apiError);

    expect(result).toBeInstanceOf(BadGatewayException);
    expect(result?.getResponse()).toEqual(
      expect.objectContaining({ message: 'Payment provider error.' }),
    );
  });

  it('maps StripeConnectionError to BadGatewayException', () => {
    const connError = new Stripe.errors.StripeConnectionError({
      message: 'Network unreachable',
      type: 'StripeConnectionError',
    } as any);

    const result = mapStripeError(connError);

    expect(result).toBeInstanceOf(BadGatewayException);
  });

  it('returns null for a non-Stripe error', () => {
    const result = mapStripeError(new Error('some other error'));
    expect(result).toBeNull();
  });

  it('returns null for a non-error value', () => {
    expect(mapStripeError('not an error')).toBeNull();
    expect(mapStripeError(undefined)).toBeNull();
  });
});
