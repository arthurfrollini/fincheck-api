import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

// Production runs Stripe in test mode for study purposes, so self-service
// billing is switched off there (BILLING_ENABLED=false): anyone could
// otherwise buy GOLD with Stripe's test card and unlock the AI quotas.
// Plans are set by an admin instead. 404, not 403: the routes don't exist.
@Injectable()
export class BillingEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.BILLING_ENABLED === 'false') {
      throw new NotFoundException();
    }
    return true;
  }
}
