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
