import { redis } from '../config/redis';
import { env } from '../config/env';

export type RateLimitResult =
  | {
      allowed: true;
      reservedAt: number;
      nextAllowedAt: null;
      reason: null;
    }
  | {
      allowed: false;
      reservedAt: null;
      nextAllowedAt: number;
      reason: 'MIN_DELAY' | 'HOURLY_LIMIT';
    };

// Lua script to atomically check and reserve an email sending slot per sender.
// Returns an array: [allowed (0 or 1), reservedAt/nextAllowedAt (timestamp), reason (string)]
const RATE_LIMIT_LUA = `
local counter_key = KEYS[1]
local last_send_key = KEYS[2]

local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local min_delay = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local next_hour_start = tonumber(ARGV[5])

-- 1. Check minimum delay constraint between consecutive sends
local last_send = tonumber(redis.call('GET', last_send_key) or '0')
if last_send > 0 and (now - last_send) < min_delay then
  return {0, last_send + min_delay, 'MIN_DELAY'}
end

-- 2. Check hourly limit constraint
local count = tonumber(redis.call('GET', counter_key) or '0')
if count >= limit then
  return {0, next_hour_start, 'HOURLY_LIMIT'}
end

-- 3. Success: increment count and update last send time
redis.call('INCR', counter_key)
if count == 0 then
  redis.call('EXPIRE', counter_key, ttl)
end
redis.call('SET', last_send_key, now)

return {1, now, ''}
`;

export class RateLimitService {
  /**
   * Generates the UTC hour window string (e.g. "2026-08-19T10")
   */
  static getUtcHourWindow(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}`;
  }

  /**
   * Reserves a send slot for a sender atomically in Redis.
   * Fails safe (throws error) if Redis is unreachable.
   */
  static async reserveSendSlot(senderId: string): Promise<RateLimitResult> {
    const now = new Date();
    const currentTimestampMs = now.getTime();

    // Generate hour window and keys
    const hourWindow = this.getUtcHourWindow(now);
    const counterKey = `email-rate:sender:${senderId}:${hourWindow}`;
    const lastSendKey = `email-rate:last-send:sender:${senderId}`;

    // Compute start of next UTC hour
    const nextHour = new Date(now);
    nextHour.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    const nextHourStartMs = nextHour.getTime();

    // Configuration settings
    const hourlyLimit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const minDelayMs = env.MIN_EMAIL_DELAY_SECONDS * 1000;
    const windowSeconds = env.RATE_LIMIT_WINDOW_SECONDS;
    const ttlSeconds = windowSeconds + 1800; // 30 mins safety margin

    try {
      // Execute the atomic reservation Lua script
      const result = await redis.eval(
        RATE_LIMIT_LUA,
        2,
        counterKey,
        lastSendKey,
        currentTimestampMs,
        hourlyLimit,
        minDelayMs,
        ttlSeconds,
        nextHourStartMs
      ) as [number, number, string];

      const [allowed, timestamp, reason] = result;

      if (allowed === 1) {
        console.log(`[RATE_LIMIT] sender=${senderId} allowed=true reservedAt=${new Date(timestamp).toISOString()}`);
        return {
          allowed: true,
          reservedAt: timestamp,
          nextAllowedAt: null,
          reason: null,
        };
      } else {
        const reasonTyped = reason as 'MIN_DELAY' | 'HOURLY_LIMIT';
        console.log(`[RATE_LIMIT] sender=${senderId} denied reason=${reasonTyped} nextAllowedAt=${new Date(timestamp).toISOString()}`);
        return {
          allowed: false,
          reservedAt: null,
          nextAllowedAt: timestamp,
          reason: reasonTyped,
        };
      }
    } catch (error) {
      console.error(`[RATE_LIMIT] Redis execution failed for sender=${senderId}:`, error);
      throw error; // Fail safe: bubble up error so the worker pauses and retries
    }
  }
}
