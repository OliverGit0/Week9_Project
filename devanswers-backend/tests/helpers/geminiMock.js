import { vi } from 'vitest';

const realFetch = globalThis.fetch;

// Intercepts only requests to the Gemini API; everything else (e.g. supertest)
// goes to the real fetch. Returns the vi.fn so tests can inspect calls.
export const mockGemini = (impl) => {
  const geminiMock = vi.fn(impl);
  vi.stubGlobal('fetch', (url, opts) =>
    String(url).includes('generativelanguage.googleapis.com')
      ? geminiMock(url, opts)
      : realFetch(url, opts),
  );
  return geminiMock;
};

export const geminiTextReply = (text) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

export const geminiJsonReply = (obj) => geminiTextReply(JSON.stringify(obj));

export const geminiErrorReply = (status) =>
  new Response(
    JSON.stringify({ error: { code: status, message: 'mock error', status: 'MOCK' } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

// Helpers to read what the SDK actually sent.
export const sentApiKey = (call) => new Headers(call[1].headers).get('x-goog-api-key');
export const sentBody = (call) => JSON.parse(call[1].body);
export const sentPromptText = (call) =>
  sentBody(call).contents.flatMap((c) => c.parts.map((p) => p.text)).join('\n');
