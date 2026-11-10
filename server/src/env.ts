/**
 * Loads settings from a `.env` file at the repo root, if there is one.
 * Imported first by index.ts so every other module sees the values.
 * Variables already set in the environment win.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
try { process.loadEnvFile(file); } catch { /* no .env file: use the environment as it is */ }
