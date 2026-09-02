import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'distribution_config.json'), 'utf8'));

const router = Router();

router.get('/', (_req, res) => {
  res.json(CONFIG);
});

export default router;
