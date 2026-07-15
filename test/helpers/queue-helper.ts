import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { MAIL_QUEUE_NAME } from '../../src/shared/mail/mail-job.types';

export function getMailQueue(app: INestApplication): Queue {
  return app.get<Queue>(getQueueToken(MAIL_QUEUE_NAME));
}

export async function waitForLatestMailJob(
  app: INestApplication,
  jobName: string,
): Promise<void> {
  const queue = getMailQueue(app);
  const jobs = await queue.getJobs(
    ['completed', 'active', 'waiting', 'delayed'],
    0,
    50,
  );
  const job = jobs.find((j) => j.name === jobName);
  if (!job) {
    throw new Error(`No "${jobName}" job found on the mail queue`);
  }

  const queueEvents = new QueueEvents(MAIL_QUEUE_NAME, {
    connection: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    },
  });
  // BullMQ's QueueEvents re-emits underlying Redis connection errors (e.g.
  // during close()/teardown races with other e2e spec files' apps sharing
  // this Redis instance) as an 'error' event. Without a listener, Node
  // treats it as an unhandled EventEmitter error and crashes the process —
  // see https://docs.bullmq.io/guide/going-to-production#log-errors.
  queueEvents.on('error', () => {
    // Swallow: this is a short-lived, per-call helper connection; the
    // caller already has its own timeout/rejection path via
    // job.waitUntilFinished.
  });
  await queueEvents.waitUntilReady();
  try {
    await job.waitUntilFinished(queueEvents, 10000);
  } finally {
    await queueEvents.close();
  }
}

export async function cleanMailQueue(app: INestApplication): Promise<void> {
  const queue = getMailQueue(app);
  await queue.obliterate({ force: true });
}
