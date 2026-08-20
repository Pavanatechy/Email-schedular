import { api } from './api';
import { ApiResponse, Email, ScheduleEmailRequest, Pagination } from '../types';

export const emailService = {
  async scheduleEmails(data: ScheduleEmailRequest): Promise<ApiResponse<{ campaignId: string; totalRecipients: number; queuedEmails: number }>> {
    const response = await api.post('/api/emails/schedule', data);
    return response.data;
  },

  async getScheduledEmails(page = 1, limit = 20): Promise<ApiResponse<{ data: Email[]; pagination: Pagination }>> {
    const response = await api.get('/api/emails/scheduled', {
      params: { page, limit },
    });
    return response.data;
  },

  async getSentEmails(page = 1, limit = 20): Promise<ApiResponse<{ data: Email[]; pagination: Pagination }>> {
    const response = await api.get('/api/emails/sent', {
      params: { page, limit },
    });
    return response.data;
  },

  async getEmailDetails(id: string): Promise<ApiResponse<Email>> {
    const response = await api.get(`/api/emails/${id}`);
    return response.data;
  },

  async retryEmail(id: string): Promise<ApiResponse<Email>> {
    const response = await api.post(`/api/emails/${id}/retry`);
    return response.data;
  },

  async cancelEmail(id: string): Promise<ApiResponse<Email>> {
    const response = await api.post(`/api/emails/${id}/cancel`);
    return response.data;
  },
};
