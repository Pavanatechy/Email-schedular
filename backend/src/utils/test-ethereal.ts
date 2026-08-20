import { prisma } from '../config/database';
import { EmailService } from '../services/email.service';
import { EmailStatus } from '@prisma/client';
import nodemailer from 'nodemailer';
import { Worker } from 'bullmq';
import { redisConfig } from '../config/redis';

async function main() {
  console.log('📬 Starting Ethereal SMTP Flow Test...');

  // Check Redis status first to prevent hanging silently
  const { redis } = require('../config/redis');
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Redis ping failed');
    console.log('🔌 Redis connection verified.');
  } catch (err: any) {
    console.error('❌ Redis is not reachable on port 6379.');
    console.error('   Please run `docker compose up -d` or start a local Redis server before running this test.');
    process.exit(1);
  }

  // 1. Create Ethereal Test Account on the fly
  console.log('🔑 Registering temporary Ethereal SMTP account...');
  const testAccount = await nodemailer.createTestAccount();
  console.log(`   User: ${testAccount.user}`);
  console.log(`   Host: ${testAccount.smtp.host}`);

  // 2. Save/Update in Sender database table
  const senderEmail = 'ethereal-test@example.com';
  let sender = await prisma.sender.findFirst({ where: { email: senderEmail } });
  if (sender) {
    sender = await prisma.sender.update({
      where: { id: sender.id },
      data: {
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUser: testAccount.user,
        smtpPassword: testAccount.pass,
      },
    });
  } else {
    sender = await prisma.sender.create({
      data: {
        name: 'Ethereal Test Sender',
        email: senderEmail,
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUser: testAccount.user,
        smtpPassword: testAccount.pass,
      },
    });
  }
  console.log(`📧 Persisted Sender record: ${sender.id}`);

  // Get or create dev user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Development User',
        email: 'dev-user@example.com',
        googleId: 'dev-google-id',
      },
    });
  }

  // 3. Schedule a test campaign email to go out in 2 seconds
  const startTime = new Date(Date.now() + 2000);
  console.log(`📅 Scheduling email to recipient@example.com at ${startTime.toISOString()}...`);

  // Override the dev sender lookup inside EmailService by upserting our newly created sender as the first sender
  // Since EmailService grabs the first sender in the DB, our newly created Ethereal sender will be picked up!
  const scheduleResult = await EmailService.scheduleEmails(user.id, {
    subject: 'Real Ethereal SMTP Test',
    body: 'Hello! This is a real test email dispatched using Nodemailer and Ethereal SMTP in Phase 3.',
    startTime: startTime.toISOString(),
    delaySeconds: 1,
    hourlyLimit: 10,
    recipients: ['recipient@example.com'],
  });

  console.log(`📢 Campaign created: ${scheduleResult.campaignId}`);

  // Find the email ID we just created
  const emailRecord = await prisma.email.findFirst({
    where: { campaignId: scheduleResult.campaignId },
  });
  if (!emailRecord) throw new Error('Email record not found after scheduling');
  console.log(`✉️ Email record created: ${emailRecord.id} (Status: ${emailRecord.status})`);

  // 4. Start the worker in-process to pick up the job
  console.log('⚙️ Initializing BullMQ Worker to process the scheduled job...');
  const workerModule = require('../queue/email.worker').default;

  console.log('⏳ Waiting for email status to transition to SENT (timeout: 30s)...');
  const maxWaitTime = 30000;
  const pollInterval = 1000;
  let elapsed = 0;
  let sentEmail = null;

  while (elapsed < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;

    sentEmail = await prisma.email.findUnique({
      where: { id: emailRecord.id },
    });

    if (sentEmail && sentEmail.status === EmailStatus.SENT) {
      console.log('\n🎉 SUCCESS! Email status transitioned to SENT.');
      console.log(`   Message ID: ${sentEmail.messageId}`);
      console.log(`   Ethereal Preview URL: ${sentEmail.previewUrl}`);
      break;
    }

    if (sentEmail && sentEmail.status === EmailStatus.FAILED) {
      console.error(`\n❌ Job failed in worker! Error: ${sentEmail.errorMessage}`);
      break;
    }

    console.log(`   [${elapsed / 1000}s] Current status: ${sentEmail?.status}...`);
  }

  if (!sentEmail || sentEmail.status !== EmailStatus.SENT) {
    console.error('\n❌ Timeout reached or sending failed.');
  }

  // 5. Clean up connections
  console.log('\n🧹 Cleaning up worker and connections...');
  await workerModule.close();
  await prisma.$disconnect();
  await redis.quit();
  console.log('👋 Done.');
}

main().catch((err) => {
  console.error('❌ Ethereal Flow Test failed:', err);
  process.exit(1);
});
