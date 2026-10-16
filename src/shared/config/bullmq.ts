import { env } from './env';

// All queues share one Redis. A distinct prefix per environment keeps the
// e2e suite's jobs (signups, categorizations, agent runs) away from a dev
// API running at the same time, whose workers would otherwise pick them up
// and, for mail, really send them. Optional like LOKI_URL: unset means
// BullMQ's own default.
export function bullRootOptions() {
  return {
    connection: { host: env.redisHost, port: Number(env.redisPort) },
    prefix: process.env.BULLMQ_PREFIX || 'bull',
  };
}
