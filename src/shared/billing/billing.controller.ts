import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { isPublic } from '@shared/decorators/public.decorator';
import { env } from '@shared/config/env';

@Controller('billing')
export class BillingController {
  private readonly stripe: Stripe;

  constructor(
    private readonly billingService: BillingService,
    private readonly billingWebhookHandler: BillingWebhookHandler,
  ) {
    this.stripe = new Stripe(env.stripeSecretKey);
  }

  @Post('setup')
  createSetupIntent(@ActiveUserId() userId: string) {
    return this.billingService.createSetupIntent(userId);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  createSubscription(
    @ActiveUserId() userId: string,
    @Body('planId') planId: string,
  ) {
    if (planId !== 'GOLD' && planId !== 'PLATINUM') {
      throw new BadRequestException('planId must be GOLD or PLATINUM');
    }
    return this.billingService.createSubscription(userId, planId as 'GOLD' | 'PLATINUM');
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePlan(
    @ActiveUserId() userId: string,
    @Body('planId') planId: string,
  ) {
    if (planId !== 'GOLD' && planId !== 'PLATINUM' && planId !== 'FREE') {
      throw new BadRequestException('planId must be GOLD, PLATINUM or FREE');
    }
    return this.billingService.changePlan(userId, planId as 'GOLD' | 'PLATINUM' | 'FREE');
  }

  @Post('cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelSubscription(@ActiveUserId() userId: string) {
    return this.billingService.cancelSubscription(userId);
  }

  @Post('webhook')
  @isPublic()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new UnauthorizedException('Missing stripe-signature header.');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        (req as any).rawBody,
        signature,
        env.stripeWebhookSecret,
      );
    } catch {
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    await this.billingWebhookHandler.handle(event);
    return { received: true };
  }
}
