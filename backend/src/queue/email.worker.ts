import { Worker, Job } from 'bullmq';
import { redisConfig, redis } from '../config/redis';
import { prisma } from '../config/database';
import { SmtpService } from '../services/smtp.service';
import { EmailStatus } from '@prisma/client';
import { EmailService } from '../services/email.service';
import { RateLimitService } from '../services/rate-limit.service';
import { emailQueue } from './email.queue';
import { env } from '../config/env';
import crypto from 'crypto';

const QUEUE_NAME = 'email-queue';
const CONCURRENCY = env.WORKER_CONCURRENCY;

/**
 * BullMQ Worker processor.
 * Performs state transitions, checks idempotency, loads SMTP settings dynamically,
 * sends using Nodemailer Ethereal driver, and logs metadata.
 */
async function processEmailJob(job: Job) {
  const { emailId } = job.data;
  const jobId = job.id;

  console.log(`[WORKER] Received job ${jobId} for emailId: ${emailId}`);

  // 1. Load the email and its associated sender config
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    console.error(`[WORKER] Job ${jobId} aborted: Email ${emailId} not found in database.`);
    return;
  }

  // 2. Idempotency protection (Sentinel check)
  if (email.status === EmailStatus.SENT) {
    console.log(`[WORKER] Job ${jobId} skipped: email=${emailId} already marked as SENT.`);
    return;
  }

  if (email.status === EmailStatus.CANCELLED) {
    console.log(`[WORKER] Job ${jobId} skipped: email=${emailId} is CANCELLED.`);
    return;
  }

  if (email.status === EmailStatus.FAILED) {
    console.log(`[WORKER] Job ${jobId} skipped: email=${emailId} is already marked as FAILED.`);
    return;
  }

  // 3. Distributed Lock: Atomic state transition (SCHEDULED -> PROCESSING)
  // Ensures multiple concurrent workers don't grab the same record, or recovers if stuck.
  const processingToken = crypto.randomUUID();
  const timeoutLimit = new Date(Date.now() - (env.PROCESSING_TIMEOUT_SECONDS * 1000));
  
  const updateResult = await prisma.email.updateMany({
    where: {
      id: emailId,
      OR: [
        { status: EmailStatus.SCHEDULED },
        {
          status: EmailStatus.PROCESSING,
          processingStartedAt: { lt: timeoutLimit }
        }
      ]
    },
    data: {
      status: EmailStatus.PROCESSING,
      processingToken,
      processingStartedAt: new Date(),
    },
  });

  if (updateResult.count === 0) {
    console.log(`[WORKER] Job ${jobId} skipped: email=${emailId} acquired by another worker or state invalid.`);
    return;
  }

  // Reload the email and confirm ownership
  const acquiredEmail = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!acquiredEmail || acquiredEmail.processingToken !== processingToken) {
    console.log(`[WORKER] Job ${jobId} skipped: email=${emailId} ownership mismatch or not found.`);
    return;
  }

  console.log(`[WORKER] email=${emailId} acquired`);
  console.log(`[WORKER] email=${emailId} processing`);

  // 4. Reserve slot in Redis (Distributed Throttling / Throttling & Concurrency Check)
  let rateLimitResult;
  try {
    rateLimitResult = await RateLimitService.reserveSendSlot(acquiredEmail.senderId);
  } catch (err: any) {
    console.error(`[WORKER] Redis rate-limiter failed for email ${emailId}. Failing safe. Error:`, err.message);
    // Revert status to SCHEDULED so that next worker attempt can try it
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: EmailStatus.SCHEDULED,
        processingToken: null,
        processingStartedAt: null,
        errorMessage: `Redis rate-limiter unavailable: ${err.message}`,
      },
    });
    // Throw to trigger BullMQ exponential backoff retry without marking FAILED
    throw err;
  }

  if (!rateLimitResult.allowed) {
    console.log(`[WORKER] Rescheduling email ${emailId} due to rate limiting: ${rateLimitResult.reason}. Next allowed time: ${new Date(rateLimitResult.nextAllowedAt).toISOString()}`);
    
    // Revert status to SCHEDULED and push scheduledAt time forward in DB, clear processing token/time
    const nextAllowedAt = new Date(rateLimitResult.nextAllowedAt);
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: EmailStatus.SCHEDULED,
        scheduledAt: nextAllowedAt,
        processingToken: null,
        processingStartedAt: null,
      },
    });

    // Remove active job from queue to prevent duplicate active jobs
    await job.remove();

    // Re-enqueue the job with the updated delay
    const delay = Math.max(0, rateLimitResult.nextAllowedAt - Date.now());
    await emailQueue.add(
      'send-email',
      { emailId },
      {
        jobId: `email-${emailId}`,
        delay,
        attempts: env.EMAIL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: env.EMAIL_RETRY_BACKOFF_MS,
        },
      }
    );
    console.log(`[WORKER] email=${emailId} retry scheduled`);
    return;
  }

  // 5. Send the email using sender configuration
  try {
    const { sender } = acquiredEmail;
    if (!sender) {
      throw new Error(`SMTP Sender configuration not found for senderId: ${acquiredEmail.senderId}`);
    }

    console.log(`[WORKER] Sending email ${emailId} to ${acquiredEmail.recipient} via sender: ${sender.email}...`);
    
    // Call SMTP service to dispatch email
    const smtpResult = await SmtpService.sendEmail(
      sender,
      acquiredEmail.recipient,
      acquiredEmail.subject,
      acquiredEmail.body,
      emailId
    );

    // 6. Success Path: transition status to SENT
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        messageId: smtpResult.messageId,
        previewUrl: smtpResult.previewUrl,
        attempts: { increment: 1 },
        processingToken: null,
        processingStartedAt: null,
      },
    });

    console.log(`[WORKER] email=${emailId} SMTP accepted`);
    console.log(`[WORKER] email=${emailId} marked SENT`);
    if (smtpResult.previewUrl) {
      console.log(`[WORKER] Ethereal Preview URL: ${smtpResult.previewUrl}`);
    }
  } catch (error: any) {
    console.error(`[WORKER] Error sending email ${emailId}:`, error.message);

    // 7. Failure / Retry Path
    const maxAttempts = env.EMAIL_JOB_ATTEMPTS;
    const currentAttempt = (job.attemptsMade || 0) + 1; // 1-indexed for matching database attempts

    if (currentAttempt < maxAttempts) {
      // Revert status to SCHEDULED so that next worker attempt can acquire it
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: EmailStatus.SCHEDULED,
          attempts: { increment: 1 },
          errorMessage: error.message || 'SMTP sending failed',
          processingToken: null,
          processingStartedAt: null,
        },
      });
      console.log(`[WORKER] Email ${emailId} failed attempt ${currentAttempt}/${maxAttempts}. Re-queued.`);
      
      // Rethrow to let BullMQ register job failure and trigger delayed retry
      throw error;
    } else {
      // Mark as FAILED (exhausted all retries)
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: EmailStatus.FAILED,
          attempts: { increment: 1 },
          errorMessage: `Exhausted ${maxAttempts} retry attempts. Error: ${error.message || 'SMTP sending failed'}`,
          processingToken: null,
          processingStartedAt: null,
        },
      });
      console.error(`[WORKER] Email ${emailId} failed permanently after ${maxAttempts} attempts.`);
    }
  }
}
// Instantiate standalone Worker process
const worker = new Worker(QUEUE_NAME, processEmailJob, {
  connection: {
    host: redisConfig.host,
    port: redisConfig.port,
    maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
  },
  concurrency: CONCURRENCY,
});

console.log(`🚀 Email worker started`);
console.log(`   Queue: "${QUEUE_NAME}"`);
console.log(`   Concurrency: ${CONCURRENCY}`);

// Run recovery sweep for unqueued database emails on startup (skipped in test mode)
if (process.env.NODE_ENV !== 'test') {
  EmailService.recoverUnqueuedEmails()
    .then((count) => {
      if (count > 0) {
        console.log(`[RECOVERY] Recovered ${count} unqueued emails on worker startup.`);
      }
    })
    .catch((err) => {
      console.error('[RECOVERY] Startup recovery sweep failed:', err);
    });
}

// Handle graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[WORKER] Gracefully shutting down worker (${signal})...`);
  
  try {
    await worker.close();
    console.log('[WORKER] BullMQ Worker closed.');
    
    await emailQueue.close();
    console.log('[WORKER] BullMQ Queue closed.');

    await redis.quit();
    console.log('[WORKER] Redis connection closed.');

    await prisma.$disconnect();
    console.log('[WORKER] Database connection closed.');
    
    console.log('[WORKER] Graceful shutdown completed.');
    process.exit(0);
  } catch (error) {
    console.error('[WORKER] Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default worker;
