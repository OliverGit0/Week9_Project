import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import '../setup.js';
import app from '../../src/app.js';
import dotenv from 'dotenv';
dotenv.config();

let jwtToken;
const realFetch = globalThis.fetch;
const ORIGINAL_KEYS = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  Gemini_API_KEY: process.env.Gemini_API_KEY,
};

beforeAll(async () => {
  const email = `aiuser+${Date.now()}@example.com`;
  const password = 'password123';
  await request(app).post('/api/auth/register').send({ name: 'AI User', email, password });
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  jwtToken = loginRes.body.data.token;
});

// Only intercept calls to Gemini; supertest's own requests must still go through.
const mockGemini = (impl) => {
  const geminiMock = vi.fn(impl);
  vi.stubGlobal('fetch', (url, opts) =>
    String(url).includes('generativelanguage.googleapis.com')
      ? geminiMock(url, opts)
      : realFetch(url, opts),
  );
  return geminiMock;
};

const geminiReply = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
  }),
});

const draft = {
  title: 'react not working',
  description: 'my useEffect runs twice??',
  tags: 'react',
};

describe('POST /api/ai/improve-question', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_RETRY_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(ORIGINAL_KEYS)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/ai/improve-question').send(draft);
    expect(res.status).toBe(401);
  });

  it('returns 400 when title or description is missing', async () => {
    const geminiMock = mockGemini();
    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: '   ', description: 'something' });

    expect(res.status).toBe(400);
    expect(geminiMock).not.toHaveBeenCalled();
  });

  it('sends all three fields in a single Gemini call and returns improved versions', async () => {
    const geminiMock = mockGemini(async () =>
      geminiReply({
        title: 'Why does useEffect run twice in React 18 development mode?',
        description: 'My useEffect callback runs twice on mount.',
        tags: ['React', 'react hooks', 'react', 'javascript', 'strict-mode', 'dev', 'extra'],
      }),
    );

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      title: 'Why does useEffect run twice in React 18 development mode?',
      description: 'My useEffect callback runs twice on mount.',
      // lowercased, hyphenated, de-duplicated, capped at 5, comma-separated
      tags: 'react, react-hooks, javascript, strict-mode, dev',
    });

    expect(geminiMock).toHaveBeenCalledTimes(1);
    const [, opts] = geminiMock.mock.calls[0];
    expect(opts.headers['x-goog-api-key']).toBe('test-key');
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    expect(prompt).toContain(draft.title);
    expect(prompt).toContain(draft.description);
    expect(prompt).toContain(draft.tags);
  });

  it('accepts the key under the Gemini_API_KEY spelling', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.Gemini_API_KEY = 'alt-key';
    const geminiMock = mockGemini(async () =>
      geminiReply({ title: 't', description: 'd', tags: [] }),
    );

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(200);
    expect(geminiMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('alt-key');
  });

  it('returns 503 when no API key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.Gemini_API_KEY;

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(503);
  });

  it('returns 502 when Gemini responds with a non-retryable error', async () => {
    const geminiMock = mockGemini(async () => ({ ok: false, status: 400, json: async () => ({}) }));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(geminiMock).toHaveBeenCalledTimes(1);
  });

  it('retries when Gemini is temporarily overloaded, then succeeds', async () => {
    const geminiMock = mockGemini()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(geminiReply({ title: 't', description: 'd', tags: ['x'] }));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(200);
    expect(geminiMock).toHaveBeenCalledTimes(2);
  });

  it('returns 503 "busy" when Gemini stays overloaded after retries', async () => {
    const geminiMock = mockGemini(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/busy/i);
    expect(geminiMock).toHaveBeenCalledTimes(3);
  });

  it('returns 502 when Gemini returns unparseable output', async () => {
    mockGemini(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
    }));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(502);
  });
});
