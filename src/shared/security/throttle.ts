import { Throttle } from '@nestjs/throttler';

const MINUTE_MS = 60_000;

// Limits are functions so they are read per request: e2e can raise them via
// .env.test (loaded after decorators are evaluated) and a test can tighten
// them at runtime. Counters are per route and per client IP.
const fromEnv = (name: string, fallback: number) => () =>
  Number(process.env[name]) || fallback;

export const DEFAULT_THROTTLE = {
  ttl: MINUTE_MS,
  limit: fromEnv('THROTTLE_DEFAULT_LIMIT', 100),
};

// Password guessing and mass signups.
export const AuthThrottle = () =>
  Throttle({
    default: { ttl: MINUTE_MS, limit: fromEnv('THROTTLE_AUTH_LIMIT', 5) },
  });

// A burst guard on top of the daily per-plan AI quotas.
export const AiThrottle = () =>
  Throttle({
    default: { ttl: MINUTE_MS, limit: fromEnv('THROTTLE_AI_LIMIT', 10) },
  });
