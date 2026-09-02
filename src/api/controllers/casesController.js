import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCase } from '../../generator.js';
import { validateCaseGenerate } from '../utils/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'distribution_config.json'), 'utf8'));

export function generateSingleCase(req, res, next) {
  try {
    const { valid, errors, data } = validateCaseGenerate(req.body);
    if (!valid) {
      const err = new Error(errors.join('; '));
      err.status = 400;
      throw err;
    }

    const c = generateCase(0, CONFIG, data.corruptionType, data.severity, data.seed);
    res.json(c);
  } catch (err) {
    next(err);
  }
}
