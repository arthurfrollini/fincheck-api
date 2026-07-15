import {
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
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { isPublic } from '@shared/decorators/public.decorator';
import { env } from '@shared/config/env';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';

@ApiTags('billing')
@ApiBearerAuth()
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
  @ApiOperation({ summary: 'Create a Stripe SetupIntent for adding a card' })
  @ApiResponse({
    status: 201,
    description: 'Returns clientSecret for Stripe Elements',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  createSetupIntent(@ActiveUserId() userId: string) {
    return this.billingService.createSetupIntent(userId);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Subscribe to a paid plan' })
  @ApiResponse({ status: 204, description: 'Subscription created' })
  @ApiResponse({ status: 400, description: 'planId must be GOLD or PLATINUM' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  createSubscription(
    @ActiveUserId() userId: string,
    @Body() { planId }: SubscribeDto,
  ) {
    return this.billingService.createSubscription(userId, planId);
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the current subscription plan' })
  @ApiResponse({ status: 204, description: 'Plan changed' })
  @ApiResponse({
    status: 400,
    description: 'planId must be GOLD, PLATINUM or FREE',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  changePlan(
    @ActiveUserId() userId: string,
    @Body() { planId }: ChangePlanDto,
  ) {
    return this.billingService.changePlan(userId, planId);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel the current subscription at period end' })
  @ApiResponse({ status: 204, description: 'Cancellation scheduled' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  cancelSubscription(@ActiveUserId() userId: string) {
    return this.billingService.cancelSubscription(userId);
  }

  @Post('webhook')
  @isPublic()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature)
      throw new UnauthorizedException('Missing stripe-signature header.');

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
