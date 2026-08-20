import { Request, Response, NextFunction } from 'express';
import { EmailService } from '../services/email.service';

export class CampaignController {
  /**
   * GET /api/campaigns
   * Returns a paginated list of campaigns.
   */
  static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const result = await EmailService.getCampaigns(req.user!.id, page, limit);

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
   * GET /api/campaigns/:id
   * Returns details for a single campaign along with email completion stats.
   */
  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const campaignWithStats = await EmailService.getCampaignById(req.user!.id, id);

      if (!campaignWithStats) {
        res.status(404).json({
          success: false,
          message: 'Campaign not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: campaignWithStats,
      });
    } catch (error) {
      next(error);
    }
  }
}
