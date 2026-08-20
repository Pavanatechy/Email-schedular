import { PrismaClient } from '@prisma/client';

// Single Prisma client instance shared across the entire application
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// Graceful shutdown helper
export async function disconnectDatabase() {
  await prisma.$disconnect();
}
