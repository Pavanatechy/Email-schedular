import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { emailQueue } from './queue/email.queue';
import { env } from './config/env';

import './config/passport'; // Initialize passport strategy
import emailRoutes from './routes/email.routes';
import campaignRoutes from './routes/campaign.routes';
import authRoutes from './routes/auth.routes';

const app = express();

// Security and utility middleware
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Session and Passport middleware
// (Commented out Redis session store to avoid legacy Redis syntax errors during development)
// const redisStore = new RedisStore({
//   client: redis,
//   prefix: 'sess:',
//   disableTouch: true,
// });

app.use(
  session({
    // store: redisStore,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// HTTP request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Basic Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Dependency Health Check Endpoint
app.get('/health/dependencies', async (req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let queueStatus = 'disconnected';
  let hasFailed = false;

  // 1. Check PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (error) {
    console.error('Database connection check failed:', error);
    hasFailed = true;
  }

  // 2. Check Redis
  try {
    const pingResult = await redis.ping();
    if (pingResult === 'PONG') {
      redisStatus = 'connected';
    } else {
      console.error(`Redis ping returned unexpected result: ${pingResult}`);
      hasFailed = true;
    }
  } catch (error) {
    console.error('Redis connection check failed:', error);
    hasFailed = true;
  }

  // 3. Check BullMQ Queue
  try {
    const client = await emailQueue.client;
    const pingResult = await (client as any).ping();
    if (pingResult === 'PONG') {
      queueStatus = 'connected';
    } else {
      console.error(`BullMQ client ping returned unexpected result: ${pingResult}`);
      hasFailed = true;
    }
  } catch (error) {
    console.error('BullMQ connection check failed:', error);
    hasFailed = true;
  }

  const responseStatus = hasFailed ? 503 : 200;
  const statusMessage = hasFailed ? 'error' : 'ok';

  res.status(responseStatus).json({
    status: statusMessage,
    database: dbStatus,
    redis: redisStatus,
    queue: queueStatus,
  });
});

// Register API Routes
app.use('/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/campaigns', campaignRoutes);

// Catch-all route (404)
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Error Handling Middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled server error message:', err.message);
  console.error('Unhandled server error stack:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

export default app;