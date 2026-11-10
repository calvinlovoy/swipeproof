import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/auth';
import { openDb, seed } from '../src/db';

const A = { 'x-client-id': 'client-aaaaaaaa' };
const B = { 'x-client-id': 'client-bbbbbbbb' };
// Test-only credentials for accounts that exist in an in-memory database.
const PASSWORD = 'test-only-passphrase';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-auth-'));
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(':memory:');
  seed(db);
  app = createApp(db, { uploadDir, ffmpeg: false });
});

const signup = (agent: ReturnType<typeof request.agent>, email: string, headers = A) =>
  agent.post('/api/auth/signup').set(headers).send({ email, password: PASSWORD, name: 'Test User' });

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const one = await hashPassword(PASSWORD);
    const two = await hashPassword(PASSWORD);
    expect(one).not.toBe(two);
    expect(one).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, one)).toBe(true);
    expect(await verifyPassword('something else', one)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
  });
});

describe('sign-up and log-in', () => {
  it('creates an account, sets an httpOnly cookie and never returns the password', async () => {
    const agent = request.agent(app);
    const res = await signup(agent, 'New@Example.com').expect(201);
    expect(res.body.user).toMatchObject({ email: 'new@example.com', name: 'Test User' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt/i);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sp_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('new@example.com');
  });
  it('rejects a duplicate email and a short password with field errors', async () => {
    await signup(request.agent(app), 'dup@example.com').expect(201);
    expect((await signup(request.agent(app), 'dup@example.com').expect(409)).body.errors.email).toBeTruthy();
    const weak = await request(app).post('/api/auth/signup').set(A).send({ email: 'x@example.com', password: 'short' }).expect(400);
    expect(weak.body.errors.password).toBeTruthy();
  });
  it('logs in, logs out and gives one message for any wrong credential', async () => {
    await signup(request.agent(app), 'in@example.com').expect(201);
    const wrongPass = await request(app).post('/api/auth/login').set(A).send({ email: 'in@example.com', password: 'wrong-passphrase' }).expect(401);
    const wrongUser = await request(app).post('/api/auth/login').set(A).send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);
    expect(wrongPass.body.message).toBe(wrongUser.body.message);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set(A).send({ email: 'IN@example.com', password: PASSWORD }).expect(200);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('in@example.com');
    await agent.post('/api/auth/logout').expect(204);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
  });
  it('locks out repeated wrong passwords', async () => {
    await signup(request.agent(app), 'lock@example.com').expect(201);
    for (let i = 0; i < 10; i++) await request(app).post('/api/auth/login').set(A).send({ email: 'lock@example.com', password: 'wrong-passphrase' }).expect(401);
    await request(app).post('/api/auth/login').set(A).send({ email: 'lock@example.com', password: PASSWORD }).expect(429);
  });
  it('refuses state-changing requests from another site', async () => {
    await request(app).post('/api/auth/login').set(A).set('Origin', 'https://evil.example').send({ email: 'a@example.com', password: PASSWORD }).expect(403);
    await request(app).post('/api/reports/hook').set(A).set('Origin', 'https://evil.example').send({ text: 'Three edits that doubled my watch time' }).expect(403);
  });
});

describe('ownership', () => {
  it('moves anonymous reports onto the account at sign-up', async () => {
    await request(app).post('/api/reports/hook').set(A).send({ text: 'Three edits that doubled my watch time' }).expect(201);
    const agent = request.agent(app);
    await signup(agent, 'claim@example.com', A).expect(201);
    expect((await agent.get('/api/reports').set(B)).body).toHaveLength(1); // follows the account, whatever browser id is sent
    expect((await request(app).get('/api/reports').set(A)).body).toHaveLength(0); // no longer visible anonymously
  });
  it('keeps two accounts apart', async () => {
    const one = request.agent(app);
    const two = request.agent(app);
    await signup(one, 'one@example.com', A).expect(201);
    await signup(two, 'two@example.com', B).expect(201);
    const made = await one.post('/api/reports/hook').set(A).send({ text: 'One clear promise in six words' }).expect(201);
    expect((await two.get('/api/reports').set(B)).body).toHaveLength(0);
    await two.get(`/api/reports/${made.body.id}`).set(A).expect(404); // borrowing the other browser id does not help
    await two.delete(`/api/reports/${made.body.id}`).set(B).expect(404);
  });
  it('carries plan and affiliate code over to the account', async () => {
    await request(app).post('/api/checkout').set(A).send({ plan: 'growth', name: 'T', email: 't@example.com' }).expect(201);
    const agent = request.agent(app);
    await signup(agent, 'plan@example.com', A).expect(201);
    expect((await agent.get('/api/me').set(B)).body.plan).toBe('growth');
  });
  it('deletes an account and its reports only with the right password', async () => {
    const agent = request.agent(app);
    await signup(agent, 'gone@example.com').expect(201);
    await agent.post('/api/reports/hook').set(A).send({ text: 'One clear promise in six words' }).expect(201);
    expect((await agent.delete('/api/auth/account').send({ password: 'wrong-passphrase' }).expect(400)).body.errors.password).toBeTruthy();
    await agent.delete('/api/auth/account').send({ password: PASSWORD }).expect(204);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    await request(app).post('/api/auth/login').set(A).send({ email: 'gone@example.com', password: PASSWORD }).expect(401);
  });
});

describe('full analysis gate', () => {
  it('needs an account, and reports clearly when the server cannot run it', async () => {
    await request(app).post('/api/analyses').set(A).expect(401);
    const agent = request.agent(app);
    await signup(agent, 'gate@example.com').expect(201);
    expect((await agent.post('/api/analyses').set(A).expect(503)).body.message).toMatch(/not available/);
    expect((await request(app).get('/api/capabilities')).body).toMatchObject({ fullAnalysis: false, transcription: false, feedback: false });
  });
});

describe('migrations', () => {
  it('upgrades a database created before accounts existed', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mig-')), 'old.db');
    const old = openDb(file);
    old.exec('DROP TABLE jobs; DROP TABLE sessions; DROP INDEX reports_by_user; ALTER TABLE reports DROP COLUMN user_id; ALTER TABLE submissions DROP COLUMN user_id; DROP TABLE users;');
    old.pragma('user_version = 0'); // how step 2 databases look
    old.prepare("INSERT INTO reports (id, client_id, type, title, score, body, created_at) VALUES ('r1', 'client-aaaaaaaa', 'hook', 't', 50, '{}', '2026-01-01')").run();
    old.close();
    const upgraded = openDb(file);
    expect(upgraded.pragma('user_version', { simple: true })).toBe(2);
    expect(upgraded.prepare('SELECT user_id FROM reports WHERE id = ?').get('r1')).toEqual({ user_id: null });
    expect(upgraded.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    upgraded.close();
  });
});
