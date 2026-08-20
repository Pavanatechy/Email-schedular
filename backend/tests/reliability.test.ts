import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { EmailStatus, QueueStatus } from '@prisma/client';
import { SmtpService } from '../src/services/smtp.service';
import { Queue, Worker } from 'bullmq';
import { RateLimitService } from '../src/services/rate-limit.service';
import { EmailService } from '../src/services/email.service';
import { env } from '../src/config/env';
import passport from 'passport';

// Mock passport session behavior
let activeUser: any = null;

jest.mock('passport', () => {
  const passport = jest.requireActual('passport');
  passport.authenticate = jest.fn().mockImplementation((strategy, options) => {
    return (req: any, res: any, next: any) => {
      if (activeUser) {
        req.user = activeUser;
        req.isAuthenticated = () => true;
      } else {
        req.isAuthenticated = () => false;
      }
      next();
    };
  });
  passport.default = passport;
  return passport;
});

// Mock ioredis completely
jest.mock('ioredis', () => {
  const mockEval = jest.fn();
  (global as any).mockEval = mockEval;
  const sessionDb: Record<string, string> = {};

  return function () {
    const clientInstance = {
      eval: (...args: any[]) => mockEval(...args),
      ping: () => Promise.resolve('PONG'),
      disconnect: () => {},
      quit: () => Promise.resolve('OK'),
      on: (event: string, callback: () => void) => {
        if (event === 'connect' || event === 'ready') {
          process.nextTick(callback);
        }
        return clientInstance;
      },
      status: 'ready',
      get: (key: string) => {
        return Promise.resolve(sessionDb[key] || null);
      },
      set: (key: string, val: string) => {
        sessionDb[key] = val;
        return Promise.resolve('OK');
      },
      expire: (key: string, seconds: number) => {
        return Promise.resolve(1);
      },
      del: (key: string | string[]) => {
        if (Array.isArray(key)) {
          key.forEach((k) => delete sessionDb[k]);
        } else {
          delete sessionDb[key];
        }
        return Promise.resolve(1);
      },
    };
    return clientInstance;
  };
});

// Mock BullMQ completely
jest.mock('bullmq', () => {
  const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
  const mockGetJob = jest.fn();
  (global as any).mockQueueAdd = mockQueueAdd;
  (global as any).mockGetJob = mockGetJob;

  return {
    Queue: jest.fn().mockImplementation(() => {
      return {
        add: mockQueueAdd,
        getJob: mockGetJob,
        close: jest.fn().mockResolvedValue(undefined),
        client: Promise.resolve({
          ping: () => Promise.resolve('PONG'),
        }),
      };
    }),
    Worker: jest.fn().mockImplementation(() => {
      return {
        close: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

// Mock SMTP Service
jest.mock('../src/services/smtp.service', () => {
  return {
    SmtpService: {
      sendEmail: jest.fn().mockResolvedValue({
        messageId: 'mock-msg-id-123',
        previewUrl: 'http://test-preview.local',
      }),
      createTransporter: jest.fn(),
    },
  };
});

describe('Email Scheduler Phase 5 - Reliability and Recovery Hardening', () => {
  let devUser: any;
  let devSender: any;
  let devCampaign: any;
  let processEmailJob: any;

  beforeAll(async () => {
    // 1. Setup dev data
    devUser = await prisma.user.upsert({
      where: { email: 'test-reliability-user@example.com' },
      update: {},
      create: {
        name: 'Test Reliability User',
        email: 'test-reliability-user@example.com',
        googleId: 'test-google-id-r',
      },
    });
    activeUser = devUser;

    devSender = await prisma.sender.create({
      data: {
        name: 'Test Reliability Sender',
        email: 'test-reliability-sender@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'test-user-r',
        smtpPassword: 'test-password-r',
      },
    });

    devCampaign = await prisma.campaign.create({
      data: {
        userId: devUser.id,
        subject: 'Reliability Test Campaign',
        body: 'Reliability Campaign Body',
        startTime: new Date(Date.now() + 100000),
        delaySeconds: 2,
        hourlyLimit: 100,
      },
    });

    // 2. Load worker processor
    require('../src/queue/email.worker');
    const mockWorkerConstructor = Worker as any;
    processEmailJob = mockWorkerConstructor.mock.calls[0][1];
  });

  afterAll(async () => {
    // Clean up
    await prisma.email.deleteMany({
      where: { senderId: devSender.id },
    });
    await prisma.campaign.deleteMany({
      where: { userId: devUser.id },
    });
    await prisma.sender.delete({
      where: { id: devSender.id },
    });
    await prisma.user.delete({
      where: { id: devUser.id },
    });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const mockEval = (global as any).mockEval;
    mockEval.mockResolvedValue([1, Date.now(), '']); // Allow rate limit by default
    (SmtpService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: 'mock-msg-id-123',
      previewUrl: 'http://test-preview.local',
    });
  });

  describe('Idempotency and Sent Email Protection', () => {
    it('should complete the job safely and not send email if status is SENT', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'idempotent-sent@test.com',
          subject: 'Sent Test',
          body: 'Sent Body',
          scheduledAt: new Date(),
          status: EmailStatus.SENT,
          queueStatus: QueueStatus.QUEUED,
        },
      });

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await processEmailJob(mockJob);

      // Verify SMTP sendEmail was NOT called
      expect(SmtpService.sendEmail).not.toHaveBeenCalled();

      // Clean up local email
      await prisma.email.delete({ where: { id: email.id } });
    });

    it('should complete the job safely and not send email if status is CANCELLED', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'idempotent-cancelled@test.com',
          subject: 'Cancelled Test',
          body: 'Cancelled Body',
          scheduledAt: new Date(),
          status: EmailStatus.CANCELLED,
          queueStatus: QueueStatus.QUEUED,
        },
      });

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await processEmailJob(mockJob);

      // Verify SMTP sendEmail was NOT called
      expect(SmtpService.sendEmail).not.toHaveBeenCalled();

      // Clean up local email
      await prisma.email.delete({ where: { id: email.id } });
    });
  });

  describe('Atomic Processing Acquisition & Concurrency Protection', () => {
    it('should allow only one worker to acquire and process a SCHEDULED email', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'atomic-concurrency@test.com',
          subject: 'Atomic Test',
          body: 'Atomic Body',
          scheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
        },
      });

      const mockJob1 = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      const mockJob2 = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      // Run both workers "concurrently"
      const p1 = processEmailJob(mockJob1);
      const p2 = processEmailJob(mockJob2);

      await Promise.all([p1, p2]);

      // Check email status is SENT (one processed it, the other skipped)
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.status).toBe(EmailStatus.SENT);

      // Verify SMTP sendEmail was called exactly once
      expect(SmtpService.sendEmail).toHaveBeenCalledTimes(1);

      // Clean up local email
      await prisma.email.delete({ where: { id: email.id } });
    });
  });

  describe('Stuck Processing Recovery', () => {
    it('should recover and process an email if status is PROCESSING but has timed out', async () => {
      const timeoutLimit = env.PROCESSING_TIMEOUT_SECONDS + 10;
      const stuckTime = new Date(Date.now() - (timeoutLimit * 1000));

      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'stuck-recovery@test.com',
          subject: 'Stuck Test',
          body: 'Stuck Body',
          scheduledAt: new Date(),
          status: EmailStatus.PROCESSING,
          processingStartedAt: stuckTime,
          processingToken: 'old-token-abc',
        },
      });

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await processEmailJob(mockJob);

      // Verify email status becomes SENT (successfully recovered and processed)
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.status).toBe(EmailStatus.SENT);
      expect(updatedEmail?.processingToken).toBeNull();
      expect(updatedEmail?.processingStartedAt).toBeNull();
      expect(SmtpService.sendEmail).toHaveBeenCalledTimes(1);

      // Clean up local email
      await prisma.email.delete({ where: { id: email.id } });
    });

    it('should NOT process an email if status is PROCESSING and has NOT timed out', async () => {
      const activeTime = new Date(Date.now() - 30 * 1000); // 30 seconds ago (active)

      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'active-no-recovery@test.com',
          subject: 'Active Test',
          body: 'Active Body',
          scheduledAt: new Date(),
          status: EmailStatus.PROCESSING,
          processingStartedAt: activeTime,
          processingToken: 'active-token-xyz',
        },
      });

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await processEmailJob(mockJob);

      // Verify email status remains PROCESSING
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.status).toBe(EmailStatus.PROCESSING);
      expect(updatedEmail?.processingToken).toBe('active-token-xyz');
      expect(SmtpService.sendEmail).not.toHaveBeenCalled();

      // Clean up local email
      await prisma.email.delete({ where: { id: email.id } });
    });
  });

  describe('Database Failures', () => {
    it('should handle db outage during worker send safely without losing state', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'db-fail@test.com',
          subject: 'DB Fail Test',
          body: 'DB Fail Body',
          scheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
        },
      });

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      // Mock prisma.email.update to throw an error simulating DB failure during success update
      const originalUpdate = prisma.email.update;
      prisma.email.update = jest.fn().mockRejectedValue(new Error('Postgres connection lost'));

      await expect(processEmailJob(mockJob)).rejects.toThrow('Postgres connection lost');

      // Revert prisma update mock
      prisma.email.update = originalUpdate;

      // Verify email remains PROCESSING or reverted depending on error (since SMTP sent but DB failed to update to SENT)
      // This matches the crash window limitation!
      const finalEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(finalEmail?.status).toBe(EmailStatus.PROCESSING); // It remains in PROCESSING because it crashed during success path

      // Clean up local email
      await prisma.email.delete({ where: { id: email.id } });
    });
  });

  describe('API Endpoints - Retry and Cancel', () => {
    it('should allow manual retry of a FAILED email and refuse SENT email', async () => {
      const failedEmail = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'failed-email@test.com',
          subject: 'Failed',
          body: 'Failed',
          scheduledAt: new Date(),
          status: EmailStatus.FAILED,
          errorMessage: 'SMTP error',
          attempts: 3,
        },
      });

      const sentEmail = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'sent-email@test.com',
          subject: 'Sent',
          body: 'Sent',
          scheduledAt: new Date(),
          status: EmailStatus.SENT,
          attempts: 1,
        },
      });

      // 1. Retry failed email
      const res1 = await request(app)
        .post(`/api/emails/${failedEmail.id}/retry`)
        .expect(200);

      expect(res1.body.success).toBe(true);
      expect(res1.body.data.status).toBe(EmailStatus.SCHEDULED);
      expect(res1.body.data.attempts).toBe(0);
      expect(res1.body.data.errorMessage).toBeNull();

      // Verify enqueued in BullMQ
      const mockQueueAdd = (global as any).mockQueueAdd;
      expect(mockQueueAdd).toHaveBeenCalled();

      // 2. Retry sent email should fail
      const res2 = await request(app)
        .post(`/api/emails/${sentEmail.id}/retry`)
        .expect(400);

      expect(res2.body.success).toBe(false);
      expect(res2.body.message).toContain('Cannot retry');

      // Clean up
      await prisma.email.delete({ where: { id: failedEmail.id } });
      await prisma.email.delete({ where: { id: sentEmail.id } });
    });

    it('should cancel a SCHEDULED email and reject SENT email cancellation', async () => {
      const scheduledEmail = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'cancel-scheduled@test.com',
          subject: 'Cancel Scheduled',
          body: 'Body',
          scheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
        },
      });

      const sentEmail = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'cancel-sent@test.com',
          subject: 'Cancel Sent',
          body: 'Body',
          scheduledAt: new Date(),
          status: EmailStatus.SENT,
        },
      });

      const mockGetJob = (global as any).mockGetJob;
      mockGetJob.mockResolvedValue({
        remove: jest.fn().mockResolvedValue(undefined),
      });

      // 1. Cancel scheduled
      const res1 = await request(app)
        .post(`/api/emails/${scheduledEmail.id}/cancel`)
        .expect(200);

      expect(res1.body.success).toBe(true);
      expect(res1.body.data.status).toBe(EmailStatus.CANCELLED);

      // 2. Cancel sent should fail
      const res2 = await request(app)
        .post(`/api/emails/${sentEmail.id}/cancel`)
        .expect(400);

      expect(res2.body.success).toBe(false);

      // Clean up
      await prisma.email.delete({ where: { id: scheduledEmail.id } });
      await prisma.email.delete({ where: { id: sentEmail.id } });
    });
  });

  describe('Queue/Database Consistency Recovery', () => {
    it('should find PENDING queue records and recover/enqueue them correctly', async () => {
      // Clean up any historical pending queue records to isolate test results
      await prisma.email.deleteMany({
        where: { queueStatus: QueueStatus.PENDING },
      });

      // 1. Create a SCHEDULED email with queueStatus = PENDING
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'recovery-test@test.com',
          subject: 'Recovery test',
          body: 'Recovery test body',
          scheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
          queueStatus: QueueStatus.PENDING,
        },
      });

      // Mock BullMQ getJob to return undefined (meaning job is missing)
      const mockGetJob = (global as any).mockGetJob;
      mockGetJob.mockResolvedValue(undefined);

      const recoveredCount = await EmailService.recoverUnqueuedEmails();

      expect(recoveredCount).toBe(1);

      // Verify email queue status is updated to QUEUED
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.queueStatus).toBe(QueueStatus.QUEUED);
      expect(updatedEmail?.bullJobId).toBe(`email-${email.id}`);

      // Verify it enqueued job in BullMQ
      const mockQueueAdd = (global as any).mockQueueAdd;
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'send-email',
        { emailId: email.id },
        expect.any(Object)
      );

      // Clean up
      await prisma.email.delete({ where: { id: email.id } });
    });
  });

  describe('Dependency Health Check', () => {
    it('should include BullMQ status in the health dependencies endpoint', async () => {
      const res = await request(app)
        .get('/health/dependencies')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe('connected');
      expect(res.body.redis).toBe('connected');
      expect(res.body.queue).toBe('connected');
    });
  });

  describe('1000 Emails Scheduling Logically', () => {
    it('should schedule 1000 emails and verify constraints logically', async () => {
      const recipients = Array.from({ length: 1000 }, (_, i) => `recipient-${i}@example.com`);

      const result = await EmailService.scheduleEmails(devUser.id, {
        recipients,
        subject: '1000 Emails Load Campaign',
        body: 'Load test body',
        startTime: new Date().toISOString(),
        delaySeconds: 2,
        hourlyLimit: 200,
      });

      expect(result.totalRecipients).toBe(1000);
      expect(result.queuedEmails).toBe(1000);

      // Verify scheduledAt spacing logic
      // Hourly limit is 200, so we have 5 hours total.
      // Recipients 0-199 schedule in Hour 0.
      // Recipients 200-399 schedule in Hour 1.
      // Let's verify a sample of email records from the campaign
      const emails = await prisma.email.findMany({
        where: { campaignId: result.campaignId },
        orderBy: { scheduledAt: 'asc' },
      });

      expect(emails.length).toBe(1000);

      // Verify first email in campaign
      expect(emails[0].recipient).toBe('recipient-0@example.com');
      expect(emails[0].status).toBe(EmailStatus.SCHEDULED);
      expect(emails[0].queueStatus).toBe(QueueStatus.QUEUED);

      // Verify hourly boundary
      // Email 199 in Hour 0. Email 200 in Hour 1 (which should be scheduledAt >= 1 hour later)
      const diffMs = emails[200].scheduledAt.getTime() - emails[0].scheduledAt.getTime();
      expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000); // at least 1 hour difference

      // Clean up the campaign emails
      await prisma.email.deleteMany({
        where: { campaignId: result.campaignId },
      });
      await prisma.campaign.delete({
        where: { id: result.campaignId },
      });
    });
  });
});
