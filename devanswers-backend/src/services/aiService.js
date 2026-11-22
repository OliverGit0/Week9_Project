import { createAppError } from "../utils/createAppError.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const MAX_TAGS = 5;
const MAX_RETRIES = 2;
const getRetryDelay = () => Number(process.env.GEMINI_RETRY_DELAY_MS ?? 1000);
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read at call time so tests (and dotenv) can set them after import.
// The .env in this project uses "Gemini_API_KEY", so accept both spellings.
const getApiKey = () => process.env.GEMINI_API_KEY || process.env.Gemini_API_KEY;
const getModel = () => process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

// Structured-output schema so Gemini always returns all three fields as JSON.
const improvementSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    description: { type: "STRING" },
    tags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["title", "description", "tags"],
};

const buildPrompt = ({ title, description, tags }) => `You are an expert editor for a programming Q&A site similar to Stack Overflow.
Improve the user's draft question so it is clear, specific, and more likely to receive good answers.

Rules:
- title: a single concise, specific sentence (max ~150 characters) that summarises the actual problem. No tags or prefixes like "Question:".
- description: rewrite for clarity and completeness. Keep every technical detail, code snippet, and error message the user provided; do not invent facts, versions, or code. Explain the goal, what was tried, and what happened vs. what was expected where the draft allows. Plain text; keep code formatting as given.
- tags: between 1 and ${MAX_TAGS} relevant, lowercase tags (use hyphens instead of spaces, e.g. "react-hooks"). Prefer well-known technology names.
- Write in the same language as the draft.

Draft title:
${title}

Draft description:
${description}

Draft tags (comma-separated, may be empty):
${tags || "(none)"}`;

const normaliseTags = (tags) =>
  [
    ...new Set(
      (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag).trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);

export const improveQuestionService = async ({ title, description, tags }) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw createAppError("AI service is not configured", 503);
  }

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: buildPrompt({ title, description, tags }) }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: improvementSchema,
    },
  });

  // Gemini regularly returns 503 ("high demand") / 429 for short spikes, so
  // retry those a couple of times with backoff before giving up.
  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(`${GEMINI_BASE_URL}/${getModel()}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw createAppError("Could not reach the AI service", 502);
    }

    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) break;
    await sleep(getRetryDelay() * 2 ** attempt);
  }

  if (!response.ok) {
    if (RETRYABLE_STATUSES.has(response.status)) {
      throw createAppError("AI service is busy, please try again shortly", 503);
    }
    throw createAppError("AI service failed to generate suggestions", 502);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw createAppError("AI service returned an invalid response", 502);
  }

  const improved = {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    description: typeof parsed.description === "string" ? parsed.description.trim() : "",
    // Return tags in the same comma-separated format the form field uses.
    tags: normaliseTags(parsed.tags).join(", "),
  };

  if (!improved.title || !improved.description) {
    throw createAppError("AI service returned an incomplete response", 502);
  }

  return improved;
};
