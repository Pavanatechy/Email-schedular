import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { EmailStatus } from '@prisma/client';
import { SmtpService } from '../src/services/smtp.service';
import { Queue, Worker } from 'bullmq';
import { RateLimitService } from '../src/services/rate-limit.service';

// Mock ioredis completely to prevent actual Redis connections during tests
// Stored on global to bypass Jest hoisting TDZ
jest.mock('ioredis', () => {
  const mockEval = jest.fn();
  (global as any).mockEval = mockEval;

  return jest.fn().mockImplementation(() => {
    return {
      eval: mockEval,
      ping: () => Promise.resolve('PONG'),
      disconnect: jest.fn(),
      quit: () => Promise.resolve('OK'),
      on: jest.fn(),
    };
  });
});

// Mock BullMQ completely using a globally accessible mock reference to bypass Jest hoisting TDZ
jest.mock('bullmq', () => {
  const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
  (global as any).mockQueueAdd = mockQueueAdd;

  return {
    Queue: jest.fn().mockImplementation(() => {
      return {
        add: mockQueueAdd,
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
      sendEmail: jest.fn(),
      createTransporter: jest.fn(),
    },
  };
});

const mockRedisState: Record<string, string> = {};

describe('Email Scheduler Phase 4 - Rate Limiting & Throttling', () => {
  let devUser: any;
  let devSender: any;
  let devCampaign: any;
  let processEmailJob: any;

  beforeAll(async () => {
    // 1. Ensure we have a dev user, sender, and campaign in the DB for tests
    devUser = await prisma.user.upsert({
      where: { email: 'test-user-p4@example.com' },
      update: {},
      create: {
        name: 'Test User P4',
        email: 'test-user-p4@example.com',
        googleId: 'test-google-id-p4',
      },
    });

    devSender = await prisma.sender.create({
      data: {
        name: 'Test Sender P4',
        email: 'test-sender-p4@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'test-user',
        smtpPassword: 'test-password',
      },
    });

    devCampaign = await prisma.campaign.create({
      data: {
        userId: devUser.id,
        subject: 'P4 Test Campaign',
        body: 'P4 Campaign Body',
        startTime: new Date(Date.now() + 100000),
        delaySeconds: 5,
        hourlyLimit: 50,
      },
    });

    // 2. Load worker processor logic ONCE
    require('../src/queue/email.worker');
    const mockWorkerConstructor = Worker as any;
    processEmailJob = mockWorkerConstructor.mock.calls[0][1];
  });

  afterAll(async () => {
    // Clean up test data
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

    // Disconnect client
    await prisma.$disconnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mock Redis state
    for (const key in mockRedisState) {
      delete mockRedisState[key];
    }
  });

  describe('RateLimitService - Unit Tests', () => {
    it('should allow a slot reservation when limits are not exceeded', async () => {
      const mockEval = (global as any).mockEval;
      mockEval.mockResolvedValue([1, 10000000, '']);

      const res = await RateLimitService.reserveSendSlot('sender-1');

      expect(res.allowed).toBe(true);
      expect(res.reservedAt).toBe(10000000);
      expect(res.nextAllowedAt).toBeNull();
      expect(res.reason).toBeNull();
    });

    it('should deny and return MIN_DELAY when minimum sending interval is violated', async () => {
      const mockEval = (global as any).mockEval;
      mockEval.mockResolvedValue([0, 10002000, 'MIN_DELAY']);

      const res = await RateLimitService.reserveSendSlot('sender-1');

      expect(res.allowed).toBe(false);
      expect(res.nextAllowedAt).toBe(10002000);
      expect(res.reason).toBe('MIN_DELAY');
    });

    it('should deny and return HOURLY_LIMIT when sender exceeds hourly quota', async () => {
      const mockEval = (global as any).mockEval;
      mockEval.mockResolvedValue([0, 10060000, 'HOURLY_LIMIT']);

      const res = await RateLimitService.reserveSendSlot('sender-1');

      expect(res.allowed).toBe(false);
      expect(res.nextAllowedAt).toBe(10060000);
      expect(res.reason).toBe('HOURLY_LIMIT');
    });
  });

  describe('Lua Rate Limiter Logic Simulation (Integrated Checks)', () => {
    beforeEach(() => {
      const mockEval = (global as any).mockEval;
      // Configure mockEval to execute simulated Redis Lua script logic
      mockEval.mockImplementation((script: any, numKeys: any, counterKey: any, lastSendKey: any, nowVal: any, limitVal: any, minDelayVal: any, ttlVal: any, nextHourStartVal: any) => {
        const now = Number(nowVal);
        const limit = Number(limitVal);
        const minDelay = Number(minDelayVal);
        const nextHourStart = Number(nextHourStartVal);

        // Check minimum delay
        const lastSend = Number(mockRedisState[lastSendKey] || '0');
        if (lastSend > 0 && (now - lastSend) < minDelay) {
          return [0, lastSend + minDelay, 'MIN_DELAY'];
        }

        // Check hourly limit
        const count = Number(mockRedisState[counterKey] || '0');
        if (count >= limit) {
          return [0, nextHourStart, 'HOURLY_LIMIT'];
        }

        // Increment count and update last send time
        mockRedisState[counterKey] = String(count + 1);
        mockRedisState[lastSendKey] = String(now);

        return [1, now, ''];
      });
    });

    it('should respect minimum send delay constraints sequentially', async () => {
      // 1st request at 10:00:00 (Allowed)
      const r1 = await RateLimitService.reserveSendSlot('sender-delay-test');
      expect(r1.allowed).toBe(true);

      // 2nd request at 10:00:01, immediately after (Denied due to MIN_DELAY)
      const r2 = await RateLimitService.reserveSendSlot('sender-delay-test');
      expect(r2.allowed).toBe(false);
      expect(r2.reason).toBe('MIN_DELAY');

      // Verify that nextAllowedAt matches exactly 2 seconds (2000ms) after the first send
      expect(r2.nextAllowedAt).toBe(r1.reservedAt! + 2000);
    });

    it('should enforce hourly rate limits independently per sender', async () => {
      const rA1 = await RateLimitService.reserveSendSlot('senderA');
      const rB1 = await RateLimitService.reserveSendSlot('senderB');

      expect(rA1.allowed).toBe(true);
      expect(rB1.allowed).toBe(true);

      // Verify Redis counter keys are isolated by checking the state structure
      const keys = Object.keys(mockRedisState);
      expect(keys.some(k => k.includes('senderA'))).toBe(true);
      expect(keys.some(k => k.includes('senderB'))).toBe(true);
    });
  });

  describe('Worker Throttling & Rescheduling Integration', () => {
    it('should successfully send email if rate reservation is allowed', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'w-allowed@test.com',
          subject: 'Allowed Test',
          body: 'Allowed Body',
          scheduledAt: new Date(),
          originalScheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
        },
      });

      // Allowed
      const mockEval = (global as any).mockEval;
      mockEval.mockResolvedValue([1, Date.now(), '']);

      const mockMsgId = 'msg-123';
      (SmtpService.sendEmail as jest.Mock).mockResolvedValue({
        messageId: mockMsgId,
        previewUrl: 'http://test.com/preview',
      });

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await processEmailJob(mockJob);

      // Verify email status becomes SENT
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.status).toBe(EmailStatus.SENT);
      expect(updatedEmail?.messageId).toBe(mockMsgId);
      expect(updatedEmail?.attempts).toBe(1);
    });

    it('should reschedule job, update scheduledAt in DB, and not consume attempts if rate-limited', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'w-denied@test.com',
          subject: 'Denied Test',
          body: 'Denied Body',
          scheduledAt: new Date(),
          originalScheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
        },
      });

      // Denied due to MIN_DELAY
      const nextTime = Date.now() + 2000;
      const mockEval = (global as any).mockEval;
      mockEval.mockResolvedValue([0, nextTime, 'MIN_DELAY']);

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
        remove: jest.fn().mockResolvedValue(undefined),
      } as any;

      await processEmailJob(mockJob);

      // 1. Verify email status remains SCHEDULED
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.status).toBe(EmailStatus.SCHEDULED);
      
      // 2. Verify scheduledAt is updated to the next allowed time
      expect(new Date(updatedEmail!.scheduledAt).getTime()).toBe(nextTime);

      // 3. Verify SMTP sending was skipped
      expect(SmtpService.sendEmail).not.toHaveBeenCalled();

      // 4. Verify job was removed and re-added with delay
      expect(mockJob.remove).toHaveBeenCalled();
      const mockQueueAdd = (global as any).mockQueueAdd;
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'send-email',
        { emailId: email.id },
        expect.objectContaining({
          jobId: `email-${email.id}`,
          delay: expect.any(Number),
        })
      );

      // 5. Verify retry attempts were NOT incremented (remains 0)
      expect(updatedEmail?.attempts).toBe(0);
    });

    it('should fail-safe, revert status to SCHEDULED, and trigger retry if Redis fails during check', async () => {
      const email = await prisma.email.create({
        data: {
          campaignId: devCampaign.id,
          senderId: devSender.id,
          recipient: 'w-redis-fail@test.com',
          subject: 'Redis Fail Test',
          body: 'Redis Fail Body',
          scheduledAt: new Date(),
          originalScheduledAt: new Date(),
          status: EmailStatus.SCHEDULED,
        },
      });

      // Redis throws connection error
      const mockEval = (global as any).mockEval;
      mockEval.mockRejectedValue(new Error('Redis connection lost'));

      const mockJob = {
        data: { emailId: email.id },
        id: `email-${email.id}`,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      // Processor must throw connection error to trigger BullMQ retry
      await expect(processEmailJob(mockJob)).rejects.toThrow('Redis connection lost');

      // Verify email status reverts to SCHEDULED and error is logged in DB
      const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
      expect(updatedEmail?.status).toBe(EmailStatus.SCHEDULED);
      expect(updatedEmail?.errorMessage).toContain('Redis rate-limiter unavailable');
      expect(updatedEmail?.attempts).toBe(0); // Redis failures should not consume SMTP attempts
      expect(SmtpService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
