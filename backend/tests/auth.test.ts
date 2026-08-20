// Setup mock user for supertest routing
let mockAuthUser: any = null;

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
        console.log('--- MOCK GET ---', key, 'db:', JSON.stringify(sessionDb));
        return Promise.resolve(sessionDb[key] || null);
      },
      set: (key: string, val: string) => {
        sessionDb[key] = val;
        console.log('--- MOCK SET ---', key, val, 'db:', JSON.stringify(sessionDb));
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

jest.mock('bullmq', () => {
  const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
  (global as any).mockQueueAdd = mockQueueAdd;

  return {
    Queue: jest.fn().mockImplementation(() => {
      return {
        add: mockQueueAdd,
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

jest.mock('passport-google-oauth20', () => {
  return {
    Strategy: jest.fn().mockImplementation((config, verify) => {
      (global as any).googleStrategyVerifyCallback = verify;
      return {
        name: 'google',
        authenticate: jest.fn(),
      };
    }),
  };
});

jest.mock('passport', () => {
  const passport = jest.requireActual('passport');
  const originalAuthenticate = passport.authenticate.bind(passport);

  passport.authenticate = jest.fn().mockImplementation((strategy, options) => {
    if (strategy === 'session') {
      return (req: any, res: any, next: any) => {
        if (mockAuthUser) {
          req.user = mockAuthUser;
          req.isAuthenticated = () => true;
          return next();
        }
        return originalAuthenticate('session', options)(req, res, next);
      };
    }

    return (req: any, res: any, next: any) => {
      if (mockAuthUser) {
        req.user = mockAuthUser;
        req.isAuthenticated = () => true;
      }

      if (strategy === 'google') {
        if (options && options.failureRedirect && !mockAuthUser) {
          return res.redirect(options.failureRedirect);
        }
        if (mockAuthUser) {
          return req.login(mockAuthUser, (err: any) => {
            if (err) return next(err);
            res.redirect('http://localhost:5173/');
          });
        }
      }
      next();
    };
  });
  passport.default = passport;
  return passport;
});

import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { EmailStatus, QueueStatus } from '@prisma/client';
import passport from 'passport';

describe('Email Scheduler Phase 6 - Authentication & Authorization', () => {
  let userA: any;
  let userB: any;
  let sender: any;
  let campaignA: any;
  let campaignB: any;
  let emailA: any;
  let emailB: any;

  beforeAll(async () => {
    // Make sure passport file is loaded so strategy verify callback is captured
    require('../src/config/passport');

    // 1. Create isolation test data
    userA = await prisma.user.create({
      data: {
        name: 'User A',
        email: 'user-a@example.com',
        googleId: 'google-id-a',
      },
    });

    userB = await prisma.user.create({
      data: {
        name: 'User B',
        email: 'user-b@example.com',
        googleId: 'google-id-b',
      },
    });

    sender = await prisma.sender.create({
      data: {
        name: 'Test Sender Auth',
        email: 'sender-auth@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'auth-user',
        smtpPassword: 'auth-password',
      },
    });

    campaignA = await prisma.campaign.create({
      data: {
        userId: userA.id,
        subject: 'Campaign A',
        body: 'Body A',
        startTime: new Date(),
        delaySeconds: 5,
        hourlyLimit: 10,
      },
    });

    campaignB = await prisma.campaign.create({
      data: {
        userId: userB.id,
        subject: 'Campaign B',
        body: 'Body B',
        startTime: new Date(),
        delaySeconds: 5,
        hourlyLimit: 10,
      },
    });

    emailA = await prisma.email.create({
      data: {
        campaignId: campaignA.id,
        senderId: sender.id,
        recipient: 'recipient-a@example.com',
        subject: 'Email A',
        body: 'Body A',
        scheduledAt: new Date(),
        status: EmailStatus.SCHEDULED,
      },
    });

    emailB = await prisma.email.create({
      data: {
        campaignId: campaignB.id,
        senderId: sender.id,
        recipient: 'recipient-b@example.com',
        subject: 'Email B',
        body: 'Body B',
        scheduledAt: new Date(),
        status: EmailStatus.SCHEDULED,
      },
    });
  });

  afterAll(async () => {
    // Clean up all testing records
    await prisma.email.deleteMany({
      where: { senderId: sender.id },
    });
    await prisma.campaign.deleteMany({
      where: { id: { in: [campaignA.id, campaignB.id] } },
    });
    await prisma.sender.delete({
      where: { id: sender.id },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockAuthUser = null;
    jest.clearAllMocks();
  });

  describe('Google OAuth Passport Strategy Callback Unit Tests', () => {
    it('should capture Strategy callback correctly during initialization', () => {
      expect((global as any).googleStrategyVerifyCallback).toBeDefined();
      expect(typeof (global as any).googleStrategyVerifyCallback).toBe('function');
    });

    it('should create new User record on first login', async () => {
      const mockProfile = {
        id: 'new-google-id',
        displayName: 'New Google User',
        emails: [{ value: 'new-user@example.com' }],
        photos: [{ value: 'http://avatar.url/new' }],
      };

      const done = jest.fn();
      await (global as any).googleStrategyVerifyCallback('access', 'refresh', mockProfile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        googleId: 'new-google-id',
        email: 'new-user@example.com',
        name: 'New Google User',
        avatarUrl: 'http://avatar.url/new',
      }));

      // Cleanup created user
      await prisma.user.delete({ where: { email: 'new-user@example.com' } });
    });

    it('should return existing User record on subsequent logins', async () => {
      const mockProfile = {
        id: 'google-id-a',
        displayName: 'Updated User A',
        emails: [{ value: 'user-a@example.com' }],
        photos: [{ value: 'http://avatar.url/a-updated' }],
      };

      const done = jest.fn();
      await (global as any).googleStrategyVerifyCallback('access', 'refresh', mockProfile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        id: userA.id,
        name: 'Updated User A',
        avatarUrl: 'http://avatar.url/a-updated',
      }));
    });

    it('should link Google account when user exists with matching email but no googleId', async () => {
      // Create user with matching email but no googleId
      const targetUser = await prisma.user.create({
        data: {
          name: 'Link User',
          email: 'link-email@example.com',
          googleId: null,
        },
      });

      const mockProfile = {
        id: 'link-google-id',
        displayName: 'Linked Name',
        emails: [{ value: 'link-email@example.com' }],
        photos: [{ value: 'http://avatar.url/linked' }],
      };

      const done = jest.fn();
      await (global as any).googleStrategyVerifyCallback('access', 'refresh', mockProfile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        id: targetUser.id,
        googleId: 'link-google-id',
        name: 'Linked Name',
        avatarUrl: 'http://avatar.url/linked',
      }));

      // Cleanup
      await prisma.user.delete({ where: { id: targetUser.id } });
    });
  });

  describe('Route-level Authentication Protection (unauthenticated -> 401)', () => {
    it('should reject unauthenticated request to GET /auth/me with 401', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated request to schedule route with 401', async () => {
      const res = await request(app).post('/api/emails/schedule').send({});
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated request to campaigns list with 401', async () => {
      const res = await request(app).get('/api/campaigns');
      expect(res.status).toBe(401);
    });
  });

  describe('Session Lifecycle Integration (Supertest Agent)', () => {
    it('should maintain authenticated user session after login, then clear on logout', async () => {
      // Use supertest request to handle cookies manually
      const agent = request(app);

      // Verify /auth/me starts unauthenticated
      await agent.get('/auth/me').expect(401);

      // Enable mock authentication user
      mockAuthUser = userA;

      // Call callback to create session and redirect
      const cbRes = await agent
        .get('/auth/google/callback')
        .expect(302)
        .expect('Location', 'http://localhost:5173/');

      const rawCookie = cbRes.headers['set-cookie']
        ? cbRes.headers['set-cookie'][0]
        : '';
      const sessionCookie = rawCookie.split(';')[0];

      expect(sessionCookie).toContain('connect.sid');

      // Disable mockAuthUser to rely 100% on the session cookie
      mockAuthUser = null;

      // Verify session cookie persists and auth/me successfully returns User A
      const r2 = await agent
        .get('/auth/me')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(r2.body.success).toBe(true);
      expect(r2.body.data.id).toBe(userA.id);
      expect(r2.body.data.email).toBe(userA.email);

      // Verify sensitive tokens are NOT exposed
      expect(r2.body.data.googleId).toBeUndefined();

      // Logout passing the session cookie
      const r3 = await agent
        .post('/auth/logout')
        .set('Cookie', sessionCookie)
        .expect(200);
      expect(r3.body.success).toBe(true);

      // Get the cookie sent on logout (which clears connect.sid)
      const logoutRawCookie = r3.headers['set-cookie']
        ? r3.headers['set-cookie'][0]
        : sessionCookie;
      const logoutCookie = logoutRawCookie.split(';')[0];

      // Verify /auth/me returns 401 again
      await agent
        .get('/auth/me')
        .set('Cookie', logoutCookie)
        .expect(401);
    });
  });

  describe('Data Isolation and Access Authorization', () => {
    beforeEach(() => {
      mockAuthUser = userA; // Authenticate as User A
    });

    it('should fetch only campaigns owned by User A', async () => {
      const res = await request(app).get('/api/campaigns').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(campaignA.id);
    });

    it('should prevent User A from retrieving details of User B\'s campaign', async () => {
      await request(app)
        .get(`/api/campaigns/${campaignB.id}`)
        .expect(404); // Returns 404 to avoid leaking existence
    });

    it('should allow User A to retrieve details of campaign A', async () => {
      const res = await request(app)
        .get(`/api/campaigns/${campaignA.id}`)
        .expect(200);
      expect(res.body.data.id).toBe(campaignA.id);
    });

    it('should prevent User A from accessing details of User B\'s email', async () => {
      await request(app)
        .get(`/api/emails/${emailB.id}`)
        .expect(404);
    });

    it('should allow User A to access details of email A', async () => {
      const res = await request(app)
        .get(`/api/emails/${emailA.id}`)
        .expect(200);
      expect(res.body.data.id).toBe(emailA.id);
    });

    it('should prevent User A from triggering retry on User B\'s email', async () => {
      const res = await request(app)
        .post(`/api/emails/${emailB.id}/retry`)
        .expect(400);
      expect(res.body.message).toContain('unauthorized');
    });

    it('should prevent User A from triggering cancellation on User B\'s email', async () => {
      const res = await request(app)
        .post(`/api/emails/${emailB.id}/cancel`)
        .expect(400);
      expect(res.body.message).toContain('unauthorized');
    });
  });

  describe('Schedule API Owner Assignment', () => {
    it('should force schedule creation campaign under authenticated user ID and ignore inputs', async () => {
      mockAuthUser = userA;

      const mockInput = {
        recipients: ['sc-test@example.com'],
        subject: 'Security Test',
        body: 'Ignore input user id',
        startTime: new Date(Date.now() + 100000).toISOString(),
        delaySeconds: 5,
        hourlyLimit: 5,
        userId: userB.id, // Client attempts to impersonate User B
      };

      const res = await request(app)
        .post('/api/emails/schedule')
        .send(mockInput)
        .expect(201);

      expect(res.body.success).toBe(true);
      const campaignId = res.body.data.campaignId;

      // Verify the campaign is owned by User A, ignoring input
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      expect(campaign?.userId).toBe(userA.id);

      // Cleanup
      await prisma.email.deleteMany({ where: { campaignId } });
      await prisma.campaign.delete({ where: { id: campaignId } });
    });
  });
});
