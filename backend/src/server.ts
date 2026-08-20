import app from './app';
import { env } from './config/env';
import { disconnectDatabase } from './config/database';
import { redis } from './config/redis';
import { emailQueue } from './queue/email.queue';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Server is running on port ${env.PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`   Health check: http://localhost:${env.PORT}/health`);
  console.log(`   Dependency check: http://localhost:${env.PORT}/health/dependencies`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\nShutting down gracefully (${signal})...`);
  
  server.close(async () => {
    console.log('HTTP server closed.');
    
    try {
      // Disconnect queue
      await emailQueue.close();
      console.log('BullMQ Queue connection closed.');

      // Disconnect Prisma
      await disconnectDatabase();
      console.log('Database connection disconnected.');

      // Disconnect Redis
      await redis.quit();
      console.log('Redis connection disconnected.');

      console.log('Graceful shutdown completed successfully.');
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
