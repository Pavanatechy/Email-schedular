export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
export type QueueStatus = 'PENDING' | 'QUEUED';

export interface Email {
  id: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  originalScheduledAt?: string;
  sentAt?: string;
  status: EmailStatus;
  queueStatus: QueueStatus;
  attempts: number;
  bullJobId?: string;
  errorMessage?: string;
  messageId?: string;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  userId: string;
  subject: string;
  body: string;
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleEmailRequest {
  subject: string;
  body: string;
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
  recipients: string[];
}

export interface Pagination {
  total: number;
  pages: number;
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
  pagination?: Pagination;
  errors?: Array<{ field: string; message: string }>;
}
