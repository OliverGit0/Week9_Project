import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import '../setup.js';
import app from '../../src/app.js';
import Question from '../../src/models/Question.js';
import Answer from '../../src/models/Answer.js';
import {
  mockGemini,
  geminiTextReply,
  geminiErrorReply,
  sentBody,
  sentPromptText,
} from '../helpers/geminiMock.js';
import dotenv from 'dotenv';
dotenv.config();

let jwtToken;
let userId;
const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_RETRY_DELAY_MS: process.env.GEMINI_RETRY_DELAY_MS,
};

beforeAll(async () => {
  const email = `summaryuser+${Date.now()}@example.com`;
  const password = 'password123';
  const reg = await request(app).post('/api/auth/register').send({ name: 'Sum User', email, password });
  userId = reg.body.data._id ?? reg.body.data.id ?? reg.body.data.userId;
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  jwtToken = loginRes.body.data.token;
  userId = userId ?? loginRes.body.data.userId;
});

const createQuestionWithAnswers = async (answerTexts) => {
  const question = await Question.create({
    title: 'How do I deep clone an object in JavaScript?',
    description: 'I need a deep copy that also handles nested arrays.',
    author: userId,
  });
  await Answer.insertMany(
    answerTexts.map((answerText, i) => ({
      questionId: question._id,
      answerText,
      author: userId,
      voteCount: i, // later answers have more votes
    })),
  );
  return question;
};

const summarize = (id, token = jwtToken) => {
  const req = request(app).post(`/api/ai/summarize-answers/${id}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('POST /api/ai/summarize-answers/:questionId', () => {
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
    const q = await createQuestionWithAnswers(['a', 'b', 'c']);
    const res = await summarize(q._id, null);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown or malformed question id', async () => {
    const geminiMock = mockGemini();
    expect((await summarize(new mongoose.Types.ObjectId())).status).toBe(404);
    expect((await summarize('not-an-id')).status).toBe(404);
    expect(geminiMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the question has fewer than 3 answers', async () => {
    const geminiMock = mockGemini();
    const q = await createQuestionWithAnswers(['only one', 'only two']);

    const res = await summarize(q._id);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 3 answers/i);
    expect(geminiMock).not.toHaveBeenCalled();
  });

  it('sends the question and every answer in one Gemini call and returns a plain-text summary', async () => {
    const answers = [
      'Use structuredClone(obj), it is built in.',
      'JSON.parse(JSON.stringify(obj)) works but loses Dates and functions.',
      'lodash cloneDeep handles edge cases.',
      'Write a recursive function if you need custom behaviour.',
    ];
    const geminiMock = mockGemini(async () =>
      geminiTextReply('**Summary:** Most answers recommend `structuredClone`.\n\n- JSON round-tripping loses Dates. Lodash is an alternative.'),
    );
    const q = await createQuestionWithAnswers(answers);

    const res = await summarize(q._id);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // markdown stripped, collapsed to a single plain-text paragraph
    expect(res.body.data.summary).toBe(
      'Summary: Most answers recommend structuredClone. JSON round-tripping loses Dates. Lodash is an alternative.',
    );

    expect(geminiMock).toHaveBeenCalledTimes(1);
    const call = geminiMock.mock.calls[0];
    const prompt = sentPromptText(call);
    expect(prompt).toContain(q.title);
    expect(prompt).toContain(q.description);
    answers.forEach((a) => expect(prompt).toContain(a));
    // highest-voted answer is listed first
    expect(prompt.indexOf(answers[3])).toBeLessThan(prompt.indexOf(answers[0]));
    expect(JSON.stringify(sentBody(call).systemInstruction)).toMatch(/3 to 5 sentences/);
  });

  it('does not increment the question view count', async () => {
    mockGemini(async () => geminiTextReply('A summary.'));
    const q = await createQuestionWithAnswers(['a', 'b', 'c']);

    await summarize(q._id);

    const after = await Question.findById(q._id);
    expect(after.views).toBe(0);
  });

  it('returns 503 "busy" when Gemini stays overloaded after retries', async () => {
    const geminiMock = mockGemini(async () => geminiErrorReply(503));
    const q = await createQuestionWithAnswers(['a', 'b', 'c']);

    const res = await summarize(q._id);

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/busy/i);
    expect(geminiMock).toHaveBeenCalledTimes(3);
  });
});
