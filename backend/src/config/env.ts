import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid connection URL" }),
  REDIS_HOST: z.string().min(1, { message: "REDIS_HOST must be specified" }),
  REDIS_PORT: z.coerce.number().default(6379),
  WORKER_CONCURRENCY: z.coerce.number().default(5),
  MIN_EMAIL_DELAY_SECONDS: z.coerce.number().default(2),
  MAX_EMAILS_PER_HOUR: z.coerce.number().default(200),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().default(200),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(3600),
  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal('')),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  GOOGLE_CALLBACK_URL: z.string().url().optional().or(z.literal('')),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  ETHEREAL_HOST: z.string().optional().or(z.literal('')),
  ETHEREAL_PORT: z.coerce.number().optional(),
  ETHEREAL_USER: z.string().optional().or(z.literal('')),
  ETHEREAL_PASSWORD: z.string().optional().or(z.literal('')),
  SESSION_SECRET: z.string().min(1, { message: "SESSION_SECRET must be specified" }).default("fallback-secret-for-dev"),
  PROCESSING_TIMEOUT_SECONDS: z.coerce.number().default(300),
  EMAIL_JOB_ATTEMPTS: z.coerce.number().default(3),
  EMAIL_RETRY_BACKOFF_MS: z.coerce.number().default(5000),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    result.error.errors.forEach((err) => {
      console.error(`   - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();
