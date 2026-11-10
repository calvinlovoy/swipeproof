import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { openDb, seed } from '../src/db';

const A = { 'x-client-id': 'client-aaaaaaaa' };
const B = { 'x-client-id': 'client-bbbbbbbb' };
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(':memory:');
  seed(db);
  app = createApp(db);
});

describe('content', () => {
  it('returns the seeded site content', async () => {
    const res = await request(app).get('/api/content').expect(200);
    expect(res.body.plans).toHaveLength(3);
    expect(res.body.faq.length).toBeGreaterThan(3);
    expect(res.body.platforms.map((p: { id: string }) => p.id)).toEqual(['tiktok', 'instagram', 'shorts']);
  });
  it('pages, filters and searches posts', async () => {
    const first = await request(app).get('/api/posts').expect(200);
    expect(first.body).toMatchObject({ total: 7, pages: 2, page: 1 });
    expect(first.body.items).toHaveLength(4);
    expect((await request(app).get('/api/posts?page=2')).body.items).toHaveLength(3);
    expect((await request(app).get('/api/posts?category=Hooks')).body.total).toBe(1);
    expect((await request(app).get('/api/posts?q=captions')).body.total).toBeGreaterThanOrEqual(1);
    expect((await request(app).get('/api/posts?q=zzzz')).body.total).toBe(0);
  });
  it('returns one post with its neighbours and 404s on a bad slug', async () => {
    const res = await request(app).get('/api/posts/spot-the-drop').expect(200);
    expect(res.body.body.length).toBeGreaterThan(1);
    expect(res.body.newer.slug).toBe('first-three-seconds');
    await request(app).get('/api/posts/nope').expect(404);
  });
});

describe('reports', () => {
  it('requires a client id', async () => {
    await request(app).get('/api/reports').expect(400);
  });
  it('scores and stores a hook, then lists, reads and deletes it', async () => {
    const made = await request(app).post('/api/reports/hook').set(A).send({ text: 'Hey guys, so today I wanted to show you some tips for editing videos' }).expect(201);
    expect(made.body).toMatchObject({ type: 'hook', score: 42 });
    expect((await request(app).get('/api/reports').set(A)).body).toHaveLength(1);
    expect((await request(app).get(`/api/reports/${made.body.id}`).set(A)).body.tight).toBe('Some tips for editing videos');
    await request(app).delete(`/api/reports/${made.body.id}`).set(A).expect(204);
    expect((await request(app).get('/api/reports').set(A)).body).toHaveLength(0);
  });
  it('keeps each client to its own reports', async () => {
    const made = await request(app).post('/api/reports/hook').set(A).send({ text: 'Three edits that doubled my watch time' }).expect(201);
    expect((await request(app).get('/api/reports').set(B)).body).toHaveLength(0);
    await request(app).get(`/api/reports/${made.body.id}`).set(B).expect(404);
    await request(app).delete(`/api/reports/${made.body.id}`).set(B).expect(404);
  });
  it('rejects empty and too-short input with field errors', async () => {
    expect((await request(app).post('/api/reports/hook').set(A).send({ text: '' }).expect(400)).body.errors.text).toBeTruthy();
    expect((await request(app).post('/api/reports/script').set(A).send({ text: 'four short little words here' }).expect(400)).body.errors.text).toBeTruthy();
  });
  it('scores a script with a pacing map', async () => {
    const text = 'Stop cutting your intro. Here is why it works.\nFirst, show the result.\nThen explain the two steps you took to get it.\nSave this for your next edit.';
    const res = await request(app).post('/api/reports/script').set(A).send({ text }).expect(201);
    expect(res.body.map).toHaveLength(5);
  });
  it('flags link reports as simulated and rejects unsupported hosts', async () => {
    const ok = await request(app).post('/api/reports/video-link').set(A).send({ url: 'https://www.tiktok.com/@a/video/1' }).expect(201);
    expect(ok.body.sim).toBe(true);
    expect((await request(app).post('/api/reports/video-link').set(A).send({ url: 'https://example.com/v' }).expect(400)).body.errors.url).toMatch(/not a TikTok/);
  });
  it('stores a browser-computed upload report and rejects malformed ones', async () => {
    const body = { type: 'video', title: 'clip.mp4', score: 64, metrics: [{ name: 'Format', score: 100, note: 'Vertical.' }], findings: [], working: ['Format: Vertical.'], meta: [['Length', '0:10']] };
    expect((await request(app).post('/api/reports/video-upload').set(A).send(body).expect(201)).body.audio).toBe(true);
    await request(app).post('/api/reports/video-upload').set(A).send({ ...body, score: 400 }).expect(400);
    await request(app).post('/api/reports/video-upload').set(A).send({ ...body, type: 'hook' }).expect(400);
  });
  it('clears a library', async () => {
    await request(app).post('/api/reports/hook').set(A).send({ text: 'One clear promise in six words' });
    await request(app).delete('/api/reports').set(A).expect(204);
    expect((await request(app).get('/api/reports').set(A)).body).toHaveLength(0);
  });
});

describe('forms', () => {
  it('validates and stores a contact message', async () => {
    const bad = await request(app).post('/api/contact').set(A).send({ name: '', email: 'x', topic: 'Support', message: 'hi' }).expect(400);
    expect(Object.keys(bad.body.errors).sort()).toEqual(['email', 'message', 'name']);
    await request(app).post('/api/contact').set(A).send({ name: 'Cal', email: 'c@example.com', topic: 'Support', message: 'A long enough message.' }).expect(201);
  });
  it('tracks plan, affiliate code and waitlist per client', async () => {
    expect((await request(app).get('/api/me').set(A)).body).toEqual({ plan: null, affiliateCode: null, waitlist: null });
    await request(app).post('/api/checkout').set(A).send({ plan: 'studio', name: 'Cal', email: 'c@example.com' }).expect(201);
    await request(app).post('/api/checkout').set(A).send({ plan: 'enterprise', name: 'Cal', email: 'c@example.com' }).expect(400);
    const aff = await request(app).post('/api/affiliates').set(A).send({ name: 'Cal Test', email: 'c@example.com', channel: 'https://example.com/c' }).expect(201);
    expect(aff.body.code).toMatch(/^SP-CT-[A-Z0-9]{4}$/);
    await request(app).post('/api/waitlist').set(A).send({ email: 'c@example.com', device: 'Android' }).expect(201);
    expect((await request(app).get('/api/me').set(A)).body).toEqual({ plan: 'studio', affiliateCode: aff.body.code, waitlist: 'Android' });
    await request(app).delete('/api/affiliates').set(A).expect(204);
    await request(app).delete('/api/waitlist').set(A).expect(204);
    expect((await request(app).get('/api/me').set(A)).body).toMatchObject({ affiliateCode: null, waitlist: null });
    expect((await request(app).get('/api/me').set(B)).body.plan).toBeNull();
  });
});

describe('errors', () => {
  it('answers unknown API routes with JSON', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body.message).toBeTruthy();
  });
  it('answers malformed JSON with a 400', async () => {
    await request(app).post('/api/contact').set(A).set('content-type', 'application/json').send('{bad').expect(400);
  });
});
