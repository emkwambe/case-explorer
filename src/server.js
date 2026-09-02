import 'dotenv/config';
import { createApp } from './api/app.js';

const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = createApp();
app.listen(PORT, () => {
  console.log(`Case Explorer API server running on http://localhost:${PORT}`);
});
