import './env';
import path from 'node:path';
import { createApp } from './app';
import { DATA_DIR, openDb, seedIfEmpty } from './db';
import { ffmpegAvailable } from './pipeline/ffmpeg';
import { sweepUploads } from './pipeline/jobs';
import { providersFromEnv } from './pipeline/providers';

const db = openDb();
seedIfEmpty(db);

const uploadDir = path.join(DATA_DIR, 'uploads');
await sweepUploads(uploadDir);

const ffmpeg = await ffmpegAvailable();
const providers = providersFromEnv();
const app = createApp(db, { providers, ffmpeg, uploadDir });

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
  console.log(`Swipeproof API listening on http://localhost:${port}`);
  console.log(`  full video analysis: ${ffmpeg ? 'on' : 'off (ffmpeg not found)'}`);
  console.log(`  transcription: ${providers.transcriber?.name ?? 'off (set OPENAI_API_KEY)'}`);
  console.log(`  written feedback: ${providers.coach?.name ?? 'off (set ANTHROPIC_API_KEY)'}`);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
