import { Router } from 'express';
import { CampaignController } from '../controllers/campaign.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/', CampaignController.getAll);
router.get('/:id', CampaignController.getById);

export default router;
