import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { env } from '@shared/config/env';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;

  constructor(private readonly usersRepository: UsersRepository) {
    this.stripe = new Stripe(env.stripeSecretKey);
  }

  private async getOrCreateCustomer(userId: string): Promise<string> {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found.');

    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await this.stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId },
    });

    await this.usersRepository.update(userId, {
      stripeCustomerId: customer.id,
    });

    return customer.id;
  }

  private priceIdForPlan(planId: 'GOLD' | 'PLATINUM'): string {
    return planId === 'GOLD' ? env.stripePriceGold : env.stripePricePlatinum;
  }

  private async getActiveSubscription(customerId: string): Promise<Stripe.Subscription> {
    const list = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });
    if (!list.data[0]) throw new BadRequestException('No active subscription found.');
    return list.data[0];
  }

  async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
    const customerId = await this.getOrCreateCustomer(userId);

    const setupIntent = await this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });

    return { clientSecret: setupIntent.client_secret! };
  }

  async createSubscription(userId: string, planId: 'GOLD' | 'PLATINUM'): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('Complete payment setup first.');
    }

    const customer = await this.stripe.customers.retrieve(
      user.stripeCustomerId,
    ) as Stripe.Customer | Stripe.DeletedCustomer;

    if (customer.deleted) {
      throw new BadRequestException('Stripe customer no longer exists.');
    }

    const paymentMethodId = (customer as Stripe.Customer).invoice_settings
      .default_payment_method as string | null;

    if (!paymentMethodId) {
      throw new BadRequestException('No payment method found. Complete setup first.');
    }

    const priceId = this.priceIdForPlan(planId);

    await this.stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      payment_behavior: 'error_if_incomplete',
    });

    await this.usersRepository.update(userId, { stripePriceId: priceId });
  }

  async changePlan(userId: string, newPlanId: 'GOLD' | 'PLATINUM' | 'FREE'): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('No active subscription.');
    }

    const subscription = await this.getActiveSubscription(user.stripeCustomerId);

    if (newPlanId === 'FREE') {
      await this.stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });
      return;
    }

    const newPriceId = this.priceIdForPlan(newPlanId);
    const isUpgrade =
      user.stripePriceId === env.stripePriceGold && newPlanId === 'PLATINUM';

    await this.stripe.subscriptions.update(subscription.id, {
      items: [{ id: subscription.items.data[0].id, price: newPriceId }],
      proration_behavior: isUpgrade ? 'always_invoice' : 'none',
    });

    await this.usersRepository.update(userId, { stripePriceId: newPriceId });
  }

  async cancelSubscription(userId: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('No active subscription.');
    }

    const subscription = await this.getActiveSubscription(user.stripeCustomerId);

    await this.stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
    });
  }

  async createCustomerAndSubscribe(
    userId: string,
    paymentMethodId: string,
    planId: 'GOLD' | 'PLATINUM',
  ): Promise<void> {
    const customerId = await this.getOrCreateCustomer(userId);

    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const priceId = this.priceIdForPlan(planId);

    await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      payment_behavior: 'error_if_incomplete',
    });

    await this.usersRepository.update(userId, { stripePriceId: priceId });
  }
}
