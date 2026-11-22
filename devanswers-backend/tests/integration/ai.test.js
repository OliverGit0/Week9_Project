import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import '../setup.js';
import app from '../../src/app.js';
import {
  mockGemini,
  geminiJsonReply,
  geminiTextReply,
  geminiErrorReply,
  sentApiKey,
  sentBody,
  sentPromptText,
} from '../helpers/geminiMock.js';
import dotenv from 'dotenv';
dotenv.config();

let jwtToken;
const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  Gemini_API_KEY: process.env.Gemini_API_KEY,
  GEMINI_RETRY_DELAY_MS: process.env.GEMINI_RETRY_DELAY_MS,
};

beforeAll(async () => {
  const email = `aiuser+${Date.now()}@example.com`;
  const password = 'password123';
  await request(app).post('/api/auth/register').send({ name: 'AI User', email, password });
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  jwtToken = loginRes.body.data.token;
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
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
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
      geminiJsonReply({
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
    const call = geminiMock.mock.calls[0];
    expect(sentApiKey(call)).toBe('test-key');
    expect(sentBody(call).generationConfig.responseMimeType).toBe('application/json');
    const prompt = sentPromptText(call);
    expect(prompt).toContain(draft.title);
    expect(prompt).toContain(draft.description);
    expect(prompt).toContain(draft.tags);
  });

  it('accepts the key under the Gemini_API_KEY spelling', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.Gemini_API_KEY = 'alt-key';
    const geminiMock = mockGemini(async () =>
      geminiJsonReply({ title: 't', description: 'd', tags: [] }),
    );

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(200);
    expect(sentApiKey(geminiMock.mock.calls[0])).toBe('alt-key');
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
    const geminiMock = mockGemini(async () => geminiErrorReply(400));

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
      .mockResolvedValueOnce(geminiErrorReply(503))
      .mockResolvedValueOnce(geminiJsonReply({ title: 't', description: 'd', tags: ['x'] }));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(200);
    expect(geminiMock).toHaveBeenCalledTimes(2);
  });

  it('returns 503 "busy" when Gemini stays overloaded after retries', async () => {
    const geminiMock = mockGemini(async () => geminiErrorReply(503));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/busy/i);
    expect(geminiMock).toHaveBeenCalledTimes(3);
  });

  it('returns 502 when Gemini returns unparseable output', async () => {
    mockGemini(async () => geminiTextReply('not json'));

    const res = await request(app)
      .post('/api/ai/improve-question')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(draft);

    expect(res.status).toBe(502);
  });
});
