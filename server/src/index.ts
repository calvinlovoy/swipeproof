import { createApp } from './app';
import { openDb, seedIfEmpty } from './db';

const db = openDb();
seedIfEmpty(db);

const port = Number(process.env.PORT ?? 3001);
const server = createApp(db).listen(port, () => {
  console.log(`Swipeproof API listening on http://localhost:${port}`);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
