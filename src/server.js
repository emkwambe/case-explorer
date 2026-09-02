import 'dotenv/config';
import { createApp } from './api/app.js';
import { createStore } from './db/index.js';

const PORT = parseInt(process.env.PORT, 10) || 3000;

const store = await createStore();
const app = createApp({ store });
app.listen(PORT, () => {
  console.log(`Case Explorer API ${process.env.DATABASE_URL ? '(PostgreSQL)' : '(in-memory store)'} listening on http://localhost:${PORT}  docs: /api/docs`);
});
