import {
  BadGatewayException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import Stripe from 'stripe';

export function mapStripeError(error: unknown): HttpException | null {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return null;
  }

  if (error instanceof Stripe.errors.StripeCardError) {
    // StripeCardError messages are designed by Stripe to be safe to show
    // end users directly (e.g. "Your card was declined.").
    return new BadRequestException(error.message);
  }

  // Every other Stripe error subclass (StripeAPIError, StripeConnectionError,
  // StripeAuthenticationError, StripeInvalidRequestError, etc.) represents
  // either Stripe's own outage or our own misconfiguration — neither is safe
  // or useful to detail to the client.
  return new BadGatewayException('Payment provider error.');
}
