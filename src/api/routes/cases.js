import { Router } from 'express';
import { generateSingleCase } from '../controllers/casesController.js';

const router = Router();

router.post('/generate', generateSingleCase);

export default router;
