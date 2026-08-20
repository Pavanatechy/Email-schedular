import { z } from 'zod';

export const scheduleEmailSchema = z.object({
  subject: z.string().min(1, { message: 'Subject cannot be empty' }),
  body: z.string().min(1, { message: 'Body cannot be empty' }),
  startTime: z.string()
    .datetime({ message: 'startTime must be a valid ISO 8601 date-time string' })
    .refine((val) => new Date(val) > new Date(), {
      message: 'startTime must be a valid future date/time',
    }),
  delaySeconds: z.number().int().min(0, { message: 'delaySeconds must be greater than or equal to 0' }),
  hourlyLimit: z.number().int().min(1, { message: 'hourlyLimit must be greater than 0' }),
  recipients: z.array(
    z.string().email({ message: 'Each recipient must be a valid email address' })
  ).min(1, { message: 'At least one recipient is required' }),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;
