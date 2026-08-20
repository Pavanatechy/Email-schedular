import { Request, Response, NextFunction } from 'express';
import { EmailService } from '../services/email.service';
import { scheduleEmailSchema } from '../utils/validation/email.validation';
import { ZodError } from 'zod';

export class EmailController {
  /**
   * POST /api/emails/schedule
   * Validates request body, schedules emails inside a transaction and returns status.
   */
  static async schedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedData = scheduleEmailSchema.parse(req.body);
      const result = await EmailService.scheduleEmails(req.user!.id, validatedData);

      res.status(201).json({
        success: true,
        message: 'Emails scheduled successfully',
        data: result,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/emails/scheduled
   * Returns a paginated list of scheduled emails.
   */
  static async getScheduled(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      if (page < 1 || limit < 1) {
        res.status(400).json({
          success: false,
          message: 'Page and limit must be positive integers',
        });
        return;
      }

      const result = await EmailService.getScheduledEmails(req.user!.id, page, limit);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/emails/sent
   * Returns a paginated list of sent emails.
   */
  static async getSent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      if (page < 1 || limit < 1) {
        res.status(400).json({
          success: false,
          message: 'Page and limit must be positive integers',
        });
        return;
      }

      const result = await EmailService.getSentEmails(req.user!.id, page, limit);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/emails/:id
   * Looks up a single email by ID.
   */
  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const email = await EmailService.getEmailById(req.user!.id, id);

      if (!email) {
        res.status(404).json({
          success: false,
          message: 'Email not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: email,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/emails/:id/retry
   * Manually retries a failed email.
   */
  static async retry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const email = await EmailService.retryEmail(req.user!.id, id);

      res.status(200).json({
        success: true,
        message: 'Email retry scheduled successfully',
        data: email,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to retry email',
      });
    }
  }

  /**
   * POST /api/emails/:id/cancel
   * Cancels a scheduled or processing email.
   */
  static async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { email, warned } = await EmailService.cancelEmail(req.user!.id, id);

      res.status(200).json({
        success: true,
        message: warned
          ? 'Email cancellation requested, but it is currently processing and may still be sent.'
          : 'Email cancelled successfully',
        data: email,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to cancel email',
      });
    }
  }
}
