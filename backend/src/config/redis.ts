import Redis from 'ioredis';
import { env } from './env';

/**
 * Reusable Redis connection configuration for future BullMQ integration and rate-limiting modules.
 */
export const redisConfig = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  // maxRetriesPerRequest must be null for BullMQ connection options to prevent issues with blocking commands.
  maxRetriesPerRequest: null,
};

export const redisUrl = `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`;
export type RedisConfig = typeof redisConfig;

// Single Redis client instance shared across the entire application
export const redis = new Redis(redisConfig);

