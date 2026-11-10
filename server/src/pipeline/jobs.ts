import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReportBody } from '../../../shared/engine';
import type { DB } from '../db';
import { AnalysisError, analyzeVideo } from './analyze';
import type { Providers } from './providers';

export interface Job { id: string; status: 'queued' | 'running' | 'done' | 'failed'; stage: string; fileName: string; reportId: string | null; error: string | null }
interface JobRow { id: string; status: Job['status']; stage: string; file_name: string; report_id: string | null; error: string | null }
const toJob = (r: JobRow): Job => ({ id: r.id, status: r.status, stage: r.stage, fileName: r.file_name, reportId: r.report_id, error: r.error });

interface Pending { id: string; userId: string; clientId: string; filePath: string; fileName: string; fileSize: number }

/**
 * Runs video analyses one at a time inside this process. The upload is deleted as soon as its
 * job finishes, whether it succeeded or failed. One process is enough for now; a second server
 * or heavier traffic calls for a real queue.
 */
export class JobQueue {
  private pending: Pending[] = [];
  private busy = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private db: DB, private providers: Providers, private saveReport: (userId: string, clientId: string, body: ReportBody) => { id: string }) {
    // Anything still marked active belonged to a process that has stopped.
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued','running')")
      .run('The server restarted before this finished. Upload the video again.', new Date().toISOString());
  }

  enqueue(userId: string, clientId: string, filePath: string, fileName: string, fileSize: number): Job {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO jobs (id, user_id, status, stage, file_name, created_at, updated_at) VALUES (?, ?, 'queued', 'Waiting to start', ?, ?, ?)").run(id, userId, fileName, now, now);
    this.pending.push({ id, userId, clientId, filePath, fileName, fileSize });
    void this.drain();
    return this.get(id, userId)!;
  }

  get(id: string, userId: string): Job | null {
    const row = this.db.prepare('SELECT id, status, stage, file_name, report_id, error FROM jobs WHERE id = ? AND user_id = ?').get(id, userId) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  /** Jobs this user started in the last 24 hours, for the daily allowance. */
  recentCount(userId: string): number {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    return (this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND created_at > ?').get(userId, since) as { n: number }).n;
  }

  /** Resolves when nothing is queued or running. Used by tests and shutdown. */
  idle(): Promise<void> {
    return !this.busy && this.pending.length === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private update(id: string, fields: Partial<{ status: Job['status']; stage: string; report_id: string; error: string }>): void {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    this.db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]!), new Date().toISOString(), id);
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.pending.shift(); job; job = this.pending.shift()) await this.runOne(job);
    } finally {
      this.busy = false;
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  private async runOne(job: Pending): Promise<void> {
    try {
      this.update(job.id, { status: 'running', stage: 'Reading the video' });
      const body = await analyzeVideo(job.filePath, job.fileName, job.fileSize, this.providers, (stage) => this.update(job.id, { stage }));
      const report = this.saveReport(job.userId, job.clientId, body);
      this.update(job.id, { status: 'done', stage: 'Done', report_id: report.id });
    } catch (e) {
      if (!(e instanceof AnalysisError)) console.error('analysis job failed:', e);
      this.update(job.id, { status: 'failed', stage: 'Failed', error: e instanceof AnalysisError ? e.message : 'Something went wrong while analyzing this video. Try again.' });
    } finally {
      await fs.rm(job.filePath, { force: true });
    }
  }
}

/** Removes uploads left behind by a crash. Runs at startup. */
export async function sweepUploads(dir: string, olderThanMs = 60 * 60_000): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.map(async (name) => {
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile() && Date.now() - stat.mtimeMs > olderThanMs) await fs.rm(file, { force: true });
  }));
}
