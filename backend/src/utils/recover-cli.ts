import { EmailService } from '../services/email.service';
import { disconnectDatabase } from '../config/database';
import { emailQueue } from '../queue/email.queue';
import { redis } from '../config/redis';

async function run() {
  console.log('[RECOVERY-CLI] Starting recovery process...');
  try {
    const count = await EmailService.recoverUnqueuedEmails();
    console.log(`[RECOVERY-CLI] Recovery completed. Recovered/verified ${count} emails.`);
  } catch (error) {
    console.error('[RECOVERY-CLI] Recovery failed:', error);
  } finally {
    try {
      await emailQueue.close();
      console.log('[RECOVERY-CLI] Queue connection closed.');
    } catch (e) {
      console.error('[RECOVERY-CLI] Error closing queue connection:', e);
    }
    
    try {
      await redis.quit();
      console.log('[RECOVERY-CLI] Redis connection closed.');
    } catch (e) {
      console.error('[RECOVERY-CLI] Error closing Redis connection:', e);
    }

    try {
      await disconnectDatabase();
      console.log('[RECOVERY-CLI] Database connection closed.');
    } catch (e) {
      console.error('[RECOVERY-CLI] Error disconnecting database:', e);
    }
    
    process.exit(0);
  }
}

run();
