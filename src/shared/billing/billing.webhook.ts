import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { MailService } from '@shared/mail/mail.service';
import { Plan } from '@modules/users/entities/User';
import { env } from '@shared/config/env';

@Injectable()
export class BillingWebhookHandler {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailService: MailService,
  ) {}

  async handle(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await this.onInvoicePaymentSucceeded(event);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event);
        break;
    }
  }

  private planFromPriceId(priceId: string): Plan {
    if (priceId === env.stripePriceGold) return Plan.GOLD;
    if (priceId === env.stripePricePlatinum) return Plan.PLATINUM;
    return Plan.FREE;
  }

  private async onInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = invoice.customer as string;

    const user = await this.usersRepository.findByStripeCustomerId(customerId);
    if (!user) return;

    const lineItem = invoice.lines.data[0];
    const priceRef = lineItem?.pricing?.price_details?.price;
    const priceId = typeof priceRef === 'string' ? priceRef : priceRef?.id;
    if (!priceId) return;

    const newPlan = this.planFromPriceId(priceId);
    const isDowngrade =
      (user.plan === Plan.PLATINUM && newPlan === Plan.GOLD) ||
      (user.plan !== Plan.FREE && newPlan === Plan.FREE);

    await this.usersRepository.update(user.id, { plan: newPlan });

    if (isDowngrade) {
      await this.mailService.sendDowngradeNotification(
        user.email,
        user.name,
        newPlan,
      );
    }
  }

  private async onSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    const user = await this.usersRepository.findByStripeCustomerId(customerId);
    if (!user) return;

    await this.usersRepository.update(user.id, {
      plan: Plan.FREE,
      stripePriceId: null,
    });

    await this.mailService.sendSubscriptionCancelled(user.email, user.name);
  }

  private async onSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    if (subscription.status !== 'active' || subscription.cancel_at_period_end) return;

    const user = await this.usersRepository.findByStripeCustomerId(customerId);
    if (!user) return;

    const priceId = subscription.items.data[0]?.price?.id;
    if (!priceId) return;

    const newPlan = this.planFromPriceId(priceId);
    await this.usersRepository.update(user.id, { plan: newPlan, stripePriceId: priceId });
  }
}
