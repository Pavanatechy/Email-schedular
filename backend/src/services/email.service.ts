import { prisma } from '../config/database';
import { EmailStatus, QueueStatus, Campaign, Email } from '@prisma/client';
import { ScheduleEmailInput } from '../utils/validation/email.validation';
import { emailQueue } from '../queue/email.queue';
import { env } from '../config/env';

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CampaignStats {
  id: string;
  subject: string;
  body: string;
  startTime: Date;
  delaySeconds: number;
  hourlyLimit: number;
  createdAt: Date;
  stats: {
    total: number;
    scheduled: number;
    sent: number;
    failed: number;
    cancelled: number;
  };
}

export class EmailService {
  /**
   * Helper to fetch or create a default development user.
   * This is a temporary placeholder that will be replaced by Google OAuth in a later phase.
   */
  private static async getOrCreateDevUser() {
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
    return user;
  }

  /**
   * Helper to fetch or create a default development SMTP sender profile.
   * This will be replaced by a proper sender selection/management configuration in future phases.
   */
  private static async getOrCreateDevSender() {
    let sender = await prisma.sender.findFirst();
    if (!sender) {
      sender = await prisma.sender.create({
        data: {
          name: 'Default Development Sender',
          email: 'dev-sender@example.com',
          smtpHost: 'smtp.ethereal.email',
          smtpPort: 587,
          smtpUser: 'dev-smtp-user',
          smtpPassword: 'dev-smtp-password',
        },
      });
    }
    return sender;
  }

  /**
   * Core scheduling helper to add a delayed job to BullMQ email-queue.
   * Job IDs are deterministic (email-{emailId}) for idempotency.
   */
  static async enqueueEmailJob(emailId: string, scheduledAt: Date): Promise<string> {
    const delay = Math.max(0, scheduledAt.getTime() - Date.now());
    const jobId = `email-${emailId}`;

    await emailQueue.add(
      'send-email',
      { emailId },
      {
        jobId,
        delay,
        attempts: env.EMAIL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: env.EMAIL_RETRY_BACKOFF_MS,
        },
      }
    );

    return jobId;
  }

  /**
   * Core scheduling logic.
   * Persists records inside a transaction, then schedules delayed BullMQ jobs.
   */
  static async scheduleEmails(userId: string, input: ScheduleEmailInput): Promise<{ campaignId: string; totalRecipients: number; queuedEmails: number }> {
    const devSender = await this.getOrCreateDevSender();

    // 1. Normalize and deduplicate recipients
    const uniqueRecipients = Array.from(
      new Set(input.recipients.map((email) => email.trim().toLowerCase()))
    );

    if (uniqueRecipients.length === 0) {
      throw new Error('No valid recipients provided after deduplication');
    }

    const startDateTime = new Date(input.startTime);
    const delayMs = input.delaySeconds * 1000;
    const limitPerHour = input.hourlyLimit;

    // Use a transaction to write the database records (bullJobId defaults to null)
    const result = await prisma.$transaction(async (tx) => {
      // 2. Create the campaign
      const campaign = await tx.campaign.create({
        data: {
          userId,
          subject: input.subject,
          body: input.body,
          startTime: startDateTime,
          delaySeconds: input.delaySeconds,
          hourlyLimit: input.hourlyLimit,
        },
      });

      // 3. Compute scheduledAt and prepare email records (bullJobId = null)
      const emailsData = uniqueRecipients.map((recipient, index) => {
        const hourOffset = Math.floor(index / limitPerHour);
        const indexInHour = index % limitPerHour;
        const hourBaseTime = startDateTime.getTime() + hourOffset * 60 * 60 * 1000;
        const scheduledTime = new Date(hourBaseTime + indexInHour * delayMs);

        return {
          campaignId: campaign.id,
          senderId: devSender.id,
          recipient,
          subject: input.subject,
          body: input.body,
          scheduledAt: scheduledTime,
          originalScheduledAt: scheduledTime,
          status: EmailStatus.SCHEDULED,
          queueStatus: QueueStatus.PENDING,
          attempts: 0,
        };
      });

      // 4. Create all emails
      await tx.email.createMany({
        data: emailsData,
      });

      // Query the newly created emails to get their IDs for queueing
      const createdEmails = await tx.email.findMany({
        where: { campaignId: campaign.id },
        select: { id: true, scheduledAt: true },
      });

      return {
        campaignId: campaign.id,
        createdEmails,
      };
    });

    // Log PENDING status for the created emails
    result.createdEmails.forEach((email) => {
      console.log(`[QUEUE] email=${email.id} status=PENDING`);
    });

    // 5. Enqueue delayed jobs in BullMQ outside the database transaction
    let queuedCount = 0;
    for (const email of result.createdEmails) {
      try {
        const jobId = await this.enqueueEmailJob(email.id, email.scheduledAt);
        
        // Update database record with the bullJobId upon successful queue addition
        await prisma.email.update({
          where: { id: email.id },
          data: {
            bullJobId: jobId,
            queueStatus: QueueStatus.QUEUED,
          },
        });
        console.log(`[QUEUE] email=${email.id} status=QUEUED`);
        queuedCount++;
      } catch (err) {
        console.error(`[QUEUE] Failed to enqueue job for email ${email.id}:`, err);
        // We do not abort the process; recovery routine will run later on startup/interval
      }
    }

    return {
      campaignId: result.campaignId,
      totalRecipients: uniqueRecipients.length,
      queuedEmails: queuedCount,
    };
  }

  /**
   * Database-to-queue recovery routine.
   * Finds SCHEDULED emails with PENDING queueStatus and enqueues them.
   */
  static async recoverUnqueuedEmails(): Promise<number> {
    console.log('[RECOVERY] Scanning for unqueued emails in database...');
    
    let totalRecovered = 0;
    const batchSize = 100;
    const failedIds = new Set<string>();

    while (true) {
      const pendingEmails = await prisma.email.findMany({
        where: {
          status: EmailStatus.SCHEDULED,
          queueStatus: QueueStatus.PENDING,
          id: {
            notIn: Array.from(failedIds)
          }
        },
        select: { id: true, scheduledAt: true },
        take: batchSize,
      });

      if (pendingEmails.length === 0) {
        break;
      }

      console.log(`[RECOVERY] Found ${pendingEmails.length} pending queue records in batch. Checking queue...`);

      for (const email of pendingEmails) {
        try {
          const jobId = `email-${email.id}`;
          const existingJob = await emailQueue.getJob(jobId);

          if (existingJob) {
            console.log(`[RECOVERY] email=${email.id} job already exists in BullMQ. Marking QUEUED.`);
            await prisma.email.update({
              where: { id: email.id },
              data: {
                queueStatus: QueueStatus.QUEUED,
                bullJobId: jobId
              },
            });
            console.log(`[QUEUE] email=${email.id} status=QUEUED`);
          } else {
            console.log(`[RECOVERY] email=${email.id} job missing in BullMQ. Restoring...`);
            await this.enqueueEmailJob(email.id, email.scheduledAt);
            await prisma.email.update({
              where: { id: email.id },
              data: {
                queueStatus: QueueStatus.QUEUED,
                bullJobId: jobId
              },
            });
            totalRecovered++;
            console.log(`[RECOVERY] email=${email.id} queue job restored`);
            console.log(`[QUEUE] email=${email.id} status=QUEUED`);
          }
        } catch (err) {
          console.error(`[RECOVERY] Failed to recover email ${email.id}:`, err);
          failedIds.add(email.id);
        }
      }
    }

    return totalRecovered;
  }

  /**
   * Lists all scheduled emails (status = SCHEDULED), sorted by scheduledAt ASC (next emails first).
   */
  static async getScheduledEmails(userId: string, page: number = 1, limit: number = 20): Promise<PaginatedResult<Partial<Email>>> {
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      prisma.email.count({ where: { status: EmailStatus.SCHEDULED, campaign: { userId } } }),
      prisma.email.findMany({
        where: { status: EmailStatus.SCHEDULED, campaign: { userId } },
        select: {
          id: true,
          recipient: true,
          subject: true,
          scheduledAt: true,
          status: true,
          campaignId: true,
        },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lists all sent emails (status = SENT), sorted by sentAt DESC (most recent first).
   */
  static async getSentEmails(userId: string, page: number = 1, limit: number = 20): Promise<PaginatedResult<Partial<Email>>> {
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      prisma.email.count({ where: { status: { in: [EmailStatus.SENT, EmailStatus.FAILED] }, campaign: { userId } } }),
      prisma.email.findMany({
        where: { status: { in: [EmailStatus.SENT, EmailStatus.FAILED] }, campaign: { userId } },
        select: {
          id: true,
          recipient: true,
          subject: true,
          sentAt: true,
          status: true,
          campaignId: true,
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves full details for a single email record.
   */
  static async getEmailById(userId: string, id: string): Promise<Email | null> {
    const email = await prisma.email.findUnique({
      where: { id },
      include: {
        campaign: true,
        sender: {
          select: {
            id: true,
            email: true,
            name: true,
            smtpHost: true,
            smtpPort: true,
            smtpUser: true,
            // Exclude smtpPassword to prevent leaking credentials
          },
        },
      },
    });

    if (!email || email.campaign.userId !== userId) {
      return null;
    }

    return email;
  }

  /**
   * Lists all campaigns with basic details.
   */
  static async getCampaigns(userId: string, page: number = 1, limit: number = 20): Promise<PaginatedResult<Campaign>> {
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      prisma.campaign.count({ where: { userId } }),
      prisma.campaign.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves a single campaign with aggregated statistics for its emails.
   */
  static async getCampaignById(userId: string, id: string): Promise<CampaignStats | null> {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign || campaign.userId !== userId) return null;

    const emailGroups = await prisma.email.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: {
        _all: true,
      },
    });

    const stats = {
      total: 0,
      scheduled: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    };

    emailGroups.forEach((group) => {
      const count = group._count._all;
      stats.total += count;
      if (group.status === EmailStatus.SCHEDULED) stats.scheduled = count;
      if (group.status === EmailStatus.SENT) stats.sent = count;
      if (group.status === EmailStatus.FAILED) stats.failed = count;
      if (group.status === EmailStatus.CANCELLED) stats.cancelled = count;
      if (group.status === EmailStatus.PROCESSING) stats.scheduled += count; // Count processing as part of scheduled for simple stats view
    });

    return {
      id: campaign.id,
      subject: campaign.subject,
      body: campaign.body,
      startTime: campaign.startTime,
      delaySeconds: campaign.delaySeconds,
      hourlyLimit: campaign.hourlyLimit,
      createdAt: campaign.createdAt,
      stats,
    };
  }

  /**
   * Manually retries a failed email.
   */
  static async retryEmail(userId: string, id: string): Promise<Email> {
    const email = await prisma.email.findUnique({
      where: { id },
      include: { campaign: true },
    });

    if (!email || email.campaign.userId !== userId) {
      throw new Error('Email not found or unauthorized');
    }

    if (email.status === EmailStatus.SENT) {
      throw new Error('Cannot retry a sent email');
    }

    if (email.status === EmailStatus.CANCELLED) {
      throw new Error('Cannot retry a cancelled email');
    }

    if (email.status === EmailStatus.PROCESSING) {
      throw new Error('Cannot retry an email that is currently processing');
    }

    if (email.status === EmailStatus.SCHEDULED) {
      throw new Error('Cannot retry an email that is already scheduled');
    }

    // Reset attempts, error, and clear processing token
    const updatedEmail = await prisma.email.update({
      where: { id },
      data: {
        status: EmailStatus.SCHEDULED,
        queueStatus: QueueStatus.PENDING,
        attempts: 0,
        errorMessage: null,
        processingToken: null,
        processingStartedAt: null,
        scheduledAt: new Date(), // send immediately
      },
    });

    console.log(`[QUEUE] email=${id} status=PENDING (manual retry)`);

    // Remove any existing job from BullMQ first to avoid duplicate
    const jobId = `email-${id}`;
    try {
      const job = await emailQueue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    } catch (err) {
      console.warn(`[QUEUE] Failed to check/remove existing job for email ${id} before manual retry:`, err);
    }

    // Enqueue
    try {
      const enqueuedJobId = await this.enqueueEmailJob(updatedEmail.id, updatedEmail.scheduledAt);
      await prisma.email.update({
        where: { id: updatedEmail.id },
        data: {
          queueStatus: QueueStatus.QUEUED,
          bullJobId: enqueuedJobId,
        },
      });
      console.log(`[QUEUE] email=${id} status=QUEUED (manual retry)`);
    } catch (err) {
      console.error(`[QUEUE] Failed to enqueue manual retry job for email ${id}:`, err);
    }

    return updatedEmail;
  }

  /**
   * Cancels a scheduled or processing email.
   */
  static async cancelEmail(userId: string, id: string): Promise<{ email: Email; warned: boolean }> {
    const email = await prisma.email.findUnique({
      where: { id },
      include: { campaign: true },
    });

    if (!email || email.campaign.userId !== userId) {
      throw new Error('Email not found or unauthorized');
    }

    if (email.status === EmailStatus.SENT) {
      throw new Error('Cannot cancel an already sent email');
    }

    if (email.status === EmailStatus.CANCELLED) {
      throw new Error('Email is already cancelled');
    }

    if (email.status === EmailStatus.FAILED) {
      throw new Error('Cannot cancel a failed email');
    }

    const wasProcessing = email.status === EmailStatus.PROCESSING;

    // Update status to CANCELLED
    const updatedEmail = await prisma.email.update({
      where: { id },
      data: {
        status: EmailStatus.CANCELLED,
        processingToken: null,
        processingStartedAt: null,
      },
    });

    console.log(`[QUEUE] email=${id} status=CANCELLED`);

    // Remove the job from the queue
    const jobId = email.bullJobId || `email-${id}`;
    try {
      const job = await emailQueue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    } catch (err) {
      console.warn(`[QUEUE] Failed to remove job for email ${id} from queue:`, err);
    }

    return {
      email: updatedEmail,
      warned: wasProcessing,
    };
  }
}
