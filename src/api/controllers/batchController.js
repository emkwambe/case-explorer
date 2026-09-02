import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBlendedCase, calculateStatistics } from '../../generator.js';
import { validateBatchGenerate } from '../utils/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'distribution_config.json'), 'utf8'));

export function generateBatch(req, res, next) {
  try {
    const { valid, errors, data } = validateBatchGenerate(req.body);
    if (!valid) {
      const err = new Error(errors.join('; '));
      err.status = 400;
      throw err;
    }

    const cases = [];
    for (let i = 0; i < data.count; i++) {
      cases.push(generateBlendedCase(i, CONFIG, data.seed, data.adversarial));
    }

    res.json({
      metadata: {
        count: data.count,
        seed: data.seed ?? null,
        adversarial: data.adversarial,
        timestamp: new Date().toISOString(),
        statistics: calculateStatistics(cases)
      },
      cases
    });
  } catch (err) {
    next(err);
  }
}
