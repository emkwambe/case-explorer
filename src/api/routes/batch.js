import { Router } from 'express';
import { generateBatch } from '../controllers/batchController.js';

const router = Router();

router.post('/generate', generateBatch);

export default router;
