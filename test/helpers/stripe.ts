import Stripe from 'stripe';

const stripe = new Stripe('sk_test_fake');
const SECRET = 'whsec_fixture';

// Builds a Stripe.Event the way production receives one: a JSON payload,
// signed and parsed by Stripe's own constructEvent. Only the fields a test
// sets are present, as with any partial webhook fixture.
export function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  id = 'evt_test',
): Stripe.Event {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    data: { object },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });
  return stripe.webhooks.constructEvent(payload, header, SECRET);
}

type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
type StripeMethod = (...args: never[]) => Promise<unknown>;

// A typed stand-in for one Stripe SDK method. Stripe objects carry dozens of
// required fields, so a test returns only the ones the code reads; the
// field names and types are still checked against the SDK.
export type StripeMethodMock<F extends StripeMethod> = jest.Mock<
  Promise<DeepPartial<Awaited<ReturnType<F>>>>,
  Parameters<F>
>;

export const stripeMethod = <F extends StripeMethod>(): StripeMethodMock<F> =>
  jest.fn<Promise<DeepPartial<Awaited<ReturnType<F>>>>, Parameters<F>>();
