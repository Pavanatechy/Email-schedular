import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.post('/schedule', EmailController.schedule);
router.get('/scheduled', EmailController.getScheduled);
router.get('/sent', EmailController.getSent);
router.get('/:id', EmailController.getById);
router.post('/:id/retry', EmailController.retry);
router.post('/:id/cancel', EmailController.cancel);

export default router;
