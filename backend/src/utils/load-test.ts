import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { EmailService } from '../services/email.service';
import { RateLimitService } from '../services/rate-limit.service';
import { EmailStatus } from '@prisma/client';
import { Worker, Job } from 'bullmq';

// Configuration overrides for fast load testing
const TOTAL_EMAILS = 200; // Limit to 200 to keep runtimes within reasonable bounds (e.g. ~4 seconds total)
const TEST_MIN_DELAY_SECONDS = 0.02; // 20ms delay between sends
const TEST_MAX_EMAILS_PER_HOUR = 100; // Force hit hourly limit boundary at 100 emails

async function main() {
  console.log('🚀 Starting Distributed Rate Limiting & Throttling Load Test...');

  // 1. Verify Redis is active
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Redis ping failed');
    console.log('🔌 Redis connection established.');
  } catch (err: any) {
    console.error('❌ Redis is not reachable on port 6379.');
    console.error('   Please run `docker compose up -d` or start a local Redis server before running this load test.');
    process.exit(1);
  }

  // 2. Override configurations dynamically for the script run
  (env as any).MIN_EMAIL_DELAY_SECONDS = TEST_MIN_DELAY_SECONDS;
  (env as any).MAX_EMAILS_PER_HOUR_PER_SENDER = TEST_MAX_EMAILS_PER_HOUR;
  (env as any).RATE_LIMIT_WINDOW_SECONDS = 15; // Set window to 15s so the next hour window triggers quickly!

  console.log(`⚙️ Test Configuration:`);
  console.log(`   Total Emails: ${TOTAL_EMAILS}`);
  console.log(`   Min Send Delay: ${TEST_MIN_DELAY_SECONDS}s (${TEST_MIN_DELAY_SECONDS * 1000}ms)`);
  console.log(`   Max Emails / Hour: ${TEST_MAX_EMAILS_PER_HOUR}`);
  console.log(`   Rate Limit Window: 15s (forces hourly transition to reset in 15 seconds)`);

  // Clear existing Redis rate limit keys to ensure clean testing environment
  const keys = await redis.keys('email-rate:*');
  if (keys.length > 0) {
    await redis.del(...keys);
    console.log(`🧹 Cleared ${keys.length} existing rate limit keys in Redis.`);
  }

  // 3. Ensure a test User and Sender exist in DB
  const user = await prisma.user.upsert({
    where: { email: 'load-test-user@example.com' },
    update: {},
    create: {
      name: 'Load Test User',
      email: 'load-test-user@example.com',
      googleId: 'load-test-google-id',
    },
  });

  const senderEmail = 'load-test-sender@example.com';
  let sender = await prisma.sender.findFirst({ where: { email: senderEmail } });
  if (!sender) {
    sender = await prisma.sender.create({
      data: {
        name: 'Load Test Sender',
        email: senderEmail,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'load-test',
        smtpPassword: 'password',
      },
    });
  }

  // Clean up any historical test emails for this campaign
  await prisma.email.deleteMany({
    where: { senderId: sender.id },
  });
  await prisma.campaign.deleteMany({
    where: { userId: user.id },
  });

  // 4. Generate 200 recipient emails
  const recipients: string[] = [];
  for (let i = 1; i <= TOTAL_EMAILS; i++) {
    recipients.push(`recipient-${i}@loadtest.com`);
  }

  console.log(`📅 Scheduling ${TOTAL_EMAILS} emails via API...`);
  const startTime = new Date();

  // Schedule through email service
  const scheduleResult = await EmailService.scheduleEmails(user.id, {
    subject: 'Load Throttling Test',
    body: 'Throttled message content',
    startTime: startTime.toISOString(),
    delaySeconds: 0,
    hourlyLimit: TEST_MAX_EMAILS_PER_HOUR,
    recipients,
  });

  console.log(`📢 Campaign created: ${scheduleResult.campaignId} (Queued: ${scheduleResult.queuedEmails})`);

  // 5. Instantiate multiple worker threads in-process to simulate concurrent cluster instances
  const workers: Worker[] = [];
  const processedEmails: { id: string; sentAt: number; senderId: string }[] = [];
  let rescheduleCount = 0;

  const createWorkerProcessor = (workerName: string) => {
    return async (job: Job) => {
      const { emailId } = job.data;

      // Fetch email record
      const email = await prisma.email.findUnique({
        where: { id: emailId },
      });

      if (!email || email.status === EmailStatus.SENT) return;

      // Lock acquisition
      const lock = await prisma.email.updateMany({
        where: { id: emailId, status: EmailStatus.SCHEDULED },
        data: { status: EmailStatus.PROCESSING },
      });

      if (lock.count === 0) return; // already acquired or sent

      // Rate reservation check
      const rateLimit = await RateLimitService.reserveSendSlot(email.senderId);

      if (!rateLimit.allowed) {
        rescheduleCount++;
        
        // Revert status to SCHEDULED
        await prisma.email.update({
          where: { id: emailId },
          data: {
            status: EmailStatus.SCHEDULED,
            scheduledAt: new Date(rateLimit.nextAllowedAt),
          },
        });

        // Reschedule
        await job.remove();
        const delay = Math.max(0, rateLimit.nextAllowedAt - Date.now());
        const { emailQueue } = require('../queue/email.queue');
        await emailQueue.add(
          'send-email',
          { emailId },
          {
            jobId: `email-${emailId}`,
            delay,
            attempts: job.opts.attempts || 3,
            backoff: job.opts.backoff,
          }
        );
        return;
      }

      // Mock SMTP send (resolve immediately for fast load test)
      const now = Date.now();
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: EmailStatus.SENT,
          sentAt: new Date(now),
          messageId: `mock-msg-${emailId}`,
          previewUrl: `http://ethereal.email/mock-msg-${emailId}`,
          attempts: { increment: 1 },
        },
      });

      processedEmails.push({ id: emailId, sentAt: now, senderId: email.senderId });
      if (processedEmails.length % 20 === 0 || processedEmails.length === TOTAL_EMAILS) {
        console.log(`   [${workerName}] Sent: ${processedEmails.length}/${TOTAL_EMAILS} (Reschedules triggered: ${rescheduleCount})`);
      }
    };
  };

  // Boot up 3 concurrent worker instances to process the queue together
  console.log('⚙️ Starting 3 parallel workers concurrently...');
  workers.push(new Worker('email-queue', createWorkerProcessor('Worker-1'), { connection: { host: env.REDIS_HOST, port: env.REDIS_PORT } }));
  workers.push(new Worker('email-queue', createWorkerProcessor('Worker-2'), { connection: { host: env.REDIS_HOST, port: env.REDIS_PORT } }));
  workers.push(new Worker('email-queue', createWorkerProcessor('Worker-3'), { connection: { host: env.REDIS_HOST, port: env.REDIS_PORT } }));

  // 6. Monitor and wait until all emails are sent
  console.log('⏳ Processing jobs under rate limit restrictions. Please wait...');
  const pollInterval = 1000;
  const timeoutMs = 60000; // 60s max timeout
  let elapsed = 0;

  while (processedEmails.length < TOTAL_EMAILS && elapsed < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  // Shut down workers
  console.log('🧹 Shutting down workers...');
  for (const w of workers) {
    await w.close();
  }

  // 7. Verify and Assert rate limit rules
  console.log('\n📊 LOAD TEST ANALYSIS RESULTS:');
  console.log(`   Total Emails Expected: ${TOTAL_EMAILS}`);
  console.log(`   Total Emails Sent: ${processedEmails.length}`);
  console.log(`   Total Reschedule Events: ${rescheduleCount}`);

  if (processedEmails.length !== TOTAL_EMAILS) {
    console.error('❌ Failed: Not all emails were delivered.');
    process.exit(1);
  }

  // Check minimum delay constraints
  // Sort by sent time
  processedEmails.sort((a, b) => a.sentAt - b.sentAt);
  let minDelayViolatedCount = 0;
  for (let i = 1; i < processedEmails.length; i++) {
    const diff = processedEmails[i].sentAt - processedEmails[i - 1].sentAt;
    // Account for slight JS timer drift (e.g. 2ms leeway)
    if (diff < (TEST_MIN_DELAY_SECONDS * 1000 - 5)) {
      minDelayViolatedCount++;
    }
  }

  console.log(`   Minimum Send Delay Violations: ${minDelayViolatedCount}`);
  if (minDelayViolatedCount > 0) {
    console.error('❌ Failed: Minimum send delay was bypassed.');
    process.exit(1);
  } else {
    console.log('   ✅ Success: Minimum send delay respected between consecutive dispatches.');
  }

  // Check hourly limit constraint
  // Since we set TEST_MAX_EMAILS_PER_HOUR = 100 and window to 15s:
  // The first 100 emails should be sent in window 1.
  // The next 100 emails must be delayed until window 2 (at least 15 seconds after the start of window 1).
  const startWindowTime = processedEmails[0].sentAt;
  const emailsInFirstWindow = processedEmails.filter(e => e.sentAt < (startWindowTime + 15000));
  
  console.log(`   Emails sent in first window (15s): ${emailsInFirstWindow.length}`);
  if (emailsInFirstWindow.length > TEST_MAX_EMAILS_PER_HOUR) {
    console.error(`❌ Failed: Exceeded hourly rate limit of ${TEST_MAX_EMAILS_PER_HOUR} emails (Sent ${emailsInFirstWindow.length}).`);
    process.exit(1);
  } else {
    console.log(`   ✅ Success: Quota limits obeyed. Maximally ${TEST_MAX_EMAILS_PER_HOUR} emails sent in one rate window.`);
  }

  console.log('🎉 LOAD TEST COMPLETED SUCCESSFULLY WITH ZERO ERRORS.');
  
  // Clean up DB and Redis connections
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Load test aborted with error:', err);
  process.exit(1);
});
