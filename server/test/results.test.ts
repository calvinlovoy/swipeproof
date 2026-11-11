import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { openDb, seed, type DB } from '../src/db';

const HEADERS = { 'x-client-id': 'client-aaaaaaaa' };
// Test-only credentials for accounts that exist in an in-memory database.
const PASSWORD = 'test-only-passphrase';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-results-'));
let db: DB;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  app = createApp(db, { uploadDir, ffmpeg: false });
});

async function account(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').set(HEADERS).send({ email, password: PASSWORD }).expect(201);
  return { agent, userId: res.body.user.id as string };
}
/** Puts a finished report straight into the database, as the analysis pipeline would. */
function addReport(userId: string, id: string, body: Record<string, unknown> = {}) {
  const full = { type: 'video', title: `${id}.mp4`, score: 60, metrics: [], findings: [], working: [], meta: [], ...body };
  db.prepare('INSERT INTO reports (id, client_id, user_id, type, title, score, simulated, body, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .run(id, 'client-aaaaaaaa', userId, full.type, full.title, full.score, JSON.stringify(full), new Date().toISOString());
}
const row = (reportId: string, impressions: number, plays3s: number) => ({ reportId, adName: `${reportId} ad`, metrics: { impressions, plays3s } });

describe('results', () => {
  it('needs an account', async () => {
    await request(app).put('/api/results').set(HEADERS).send({ rows: [row('v1', 100, 20)] }).expect(401);
    await request(app).get('/api/results').set(HEADERS).expect(401);
    await request(app).delete('/api/results').set(HEADERS).expect(401);
  });

  it('saves rows only against the caller\'s own video reports', async () => {
    const mine = await account('mine@example.com');
    const theirs = await account('theirs@example.com');
    addReport(mine.userId, 'v1', { traits: { firstCut: 1 } });
    addReport(mine.userId, 'h1', { type: 'hook' });
    addReport(theirs.userId, 'other', { traits: { firstCut: 2 } });

    const res = await mine.agent.put('/api/results').set(HEADERS).send({
      rows: [row('v1', 1000, 250), row('h1', 10, 1), row('other', 10, 1), row('missing', 10, 1), { reportId: 'v1', adName: 'no numbers', metrics: { impressions: 'lots', spend: -4 } }],
    }).expect(200);
    expect(res.body).toEqual({ saved: 1 });
    const page = (await mine.agent.get('/api/results').set(HEADERS).expect(200)).body;
    expect(page.videos).toEqual([{ reportId: 'v1', title: 'v1.mp4', adName: 'v1 ad', score: 60, traits: { firstCut: 1 }, outcomes: { hookRate: 25 } }]);
    expect((await theirs.agent.get('/api/results').set(HEADERS)).body.videos).toEqual([]);

    await mine.agent.put('/api/results').set(HEADERS).send({ rows: [row('other', 10, 1)] }).expect(400);
    await mine.agent.put('/api/results').set(HEADERS).send({ rows: [] }).expect(400);
    await mine.agent.put('/api/results').set(HEADERS).send({}).expect(400);
  });

  it('replaces a saved row and finds patterns once there are enough videos', async () => {
    const { agent, userId } = await account('patterns@example.com');
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    ids.forEach((id, i) => addReport(userId, id, { traits: { firstCut: i + 1, duration: 20 } }));
    // The later the first cut, the lower the hook rate.
    await agent.put('/api/results').set(HEADERS).send({ rows: ids.slice(0, 4).map((id, i) => row(id, 1000, 400 - i * 50)) }).expect(200);
    let page = (await agent.get('/api/results').set(HEADERS)).body;
    expect(page.minVideos).toBe(5);
    expect(page.patterns.hookRate).toEqual({ videos: 4, patterns: [] });

    await agent.put('/api/results').set(HEADERS).send({ rows: ids.map((id, i) => row(id, 1000, 400 - i * 50)) }).expect(200);
    page = (await agent.get('/api/results').set(HEADERS)).body;
    expect(page.videos).toHaveLength(6);
    expect(page.patterns.hookRate.videos).toBe(6);
    expect(page.patterns.hookRate.patterns).toHaveLength(1);
    expect(page.patterns.hookRate.patterns[0]).toMatchObject({ key: 'firstCut', rho: -1, strength: 'strong', helps: false, above: { n: 3 }, below: { n: 3 } });
    expect(page.patterns.ctr).toEqual({ videos: 0, patterns: [] });
  });

  it('removes results on request, with their report and with the account', async () => {
    const { agent, userId } = await account('cleanup@example.com');
    ['a', 'b'].forEach((id) => addReport(userId, id, { traits: { firstCut: 1 } }));
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM results').get() as { n: number }).n;
    await agent.put('/api/results').set(HEADERS).send({ rows: [row('a', 100, 20), row('b', 100, 30)] }).expect(200);
    await agent.delete('/api/reports/a').set(HEADERS).expect(204);
    expect(count()).toBe(1);
    await agent.delete('/api/results').set(HEADERS).expect(204);
    expect(count()).toBe(0);
    await agent.put('/api/results').set(HEADERS).send({ rows: [row('b', 100, 30)] }).expect(200);
    await agent.delete('/api/auth/account').set(HEADERS).send({ password: PASSWORD }).expect(204);
    expect(count()).toBe(0);
  });
});
