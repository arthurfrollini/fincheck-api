export abstract class StripeEventsRepository {
  /**
   * Records a Stripe event id as processed. Returns false when the event
   * was already registered (unique violation) — i.e. a duplicate delivery.
   */
  abstract register(eventId: string, type: string): Promise<boolean>;
  abstract unregister(eventId: string): Promise<void>;
  abstract deleteOlderThan(date: Date): Promise<void>;
}
