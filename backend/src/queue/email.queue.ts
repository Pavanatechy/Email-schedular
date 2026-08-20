import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis';

// Name of our persistent job queue
export const EMAIL_QUEUE_NAME = 'email-queue';

/**
 * Shared BullMQ Queue instance for scheduling delayed email dispatch jobs.
 * Uses the validated Redis connection configuration.
 */
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: {
    host: redisConfig.host,
    port: redisConfig.port,
    // maxRetriesPerRequest is set to null in redisConfig which is essential for BullMQ
    maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
  },
  defaultJobOptions: {
    removeOnComplete: true, // Clean up jobs from Redis once completed successfully
    removeOnFail: false,    // Keep failed jobs for diagnostic inspection or retry tracking
  },
});

console.log(`[QUEUE] Configured BullMQ queue: "${EMAIL_QUEUE_NAME}"`);
