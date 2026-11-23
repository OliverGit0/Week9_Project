import { GoogleGenAI, ApiError } from "@google/genai";
import mongoose from "mongoose";
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import { createAppError } from "../utils/createAppError.js";

// Model name as used throughout the official Gemini API docs (verified via Context7). Updated to 3.5 which appeared
// to be the latest stable version at the time of writing.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3; // initial call + 2 retries
const MAX_TAGS = 5;
const MIN_ANSWERS_TO_SUMMARIZE = 3;
const MAX_ANSWER_CHARS = 4000;

// Read at call time so tests (and dotenv) can set them after import.
// The .env in this project uses "Gemini_API_KEY", so accept both spellings.
const getApiKey = () => process.env.GEMINI_API_KEY || process.env.Gemini_API_KEY;
const getModel = () => process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const getRetryDelaySeconds = () => Number(process.env.GEMINI_RETRY_DELAY_MS ?? 1000) / 1000;

/**
 * Makes exactly one Gemini generateContent request (the SDK may retry that
 * same request on transient 408/429/5xx errors) and returns the response text.
 * Maps SDK/network failures to app errors with sensible HTTP statuses.
 */
const callGemini = async ({ contents, config }) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw createAppError("AI service is not configured", 503);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: REQUEST_TIMEOUT_MS,
      retryOptions: { attempts: MAX_ATTEMPTS, initialDelay: getRetryDelaySeconds() },
    },
  });

  let response;
  try {
    response = await ai.models.generateContent({ model: getModel(), contents, config });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    if (status === 429 || status === 408 || status >= 500) {
      throw createAppError("AI service is busy, please try again shortly", 503);
    }
    if (status) {
      throw createAppError("AI service failed to generate a response", 502);
    }
    throw createAppError("Could not reach the AI service", 502);
  }

  const text = response?.text;
  if (!text || !text.trim()) {
    throw createAppError("AI service returned an empty response", 502);
  }
  return text;
};

// ── Question Quality Improver ───────────────────────────────────────────────

// Structured-output schema so Gemini always returns all three fields as JSON.
const improvementSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "description", "tags"],
};

const buildImprovePrompt = ({ title, description, tags }) => `You are an expert editor for a programming Q&A site similar to Stack Overflow.
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
  const text = await callGemini({
    contents: buildImprovePrompt({ title, description, tags }),
    config: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: improvementSchema,
    },
  });

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

// ── Answer Summarizer ───────────────────────────────────────────────────────

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, max)}… [truncated]` : text;

const buildSummaryPrompt = (question, answers) => {
  const answerBlocks = answers
    .map(
      (answer, i) =>
        `Answer ${i + 1} (votes: ${answer.voteCount ?? 0}):\n${truncate(answer.answerText, MAX_ANSWER_CHARS)}`,
    )
    .join("\n\n");

  return `Question title:
${question.title}

Question description:
${question.description}

${answers.length} answers:

${answerBlocks}`;
};

const SUMMARY_INSTRUCTION = `You summarise the answers to a question on a programming Q&A site similar to Stack Overflow.
Write a concise summary of 3 to 5 sentences in plain text: no markdown, no bullet points, no headings, no code blocks.
Capture the main solutions or recommendations the answers give, where they agree or disagree, and any important caveats.
Give more weight to higher-voted answers. Only use information contained in the answers; do not add your own solutions.
Write in the same language as the question.`;

// Defensive clean-up in case the model still emits light markdown.
const toPlainText = (text) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const summarizeAnswersService = async (questionId) => {
  if (!mongoose.Types.ObjectId.isValid(questionId)) {
    throw createAppError("Question not found", 404);
  }

  // Plain lookup (not getQuestionByIdService) so summarising doesn't add a view.
  const question = await Question.findById(questionId).select("title description").lean();
  if (!question) {
    throw createAppError("Question not found", 404);
  }

  const answers = await Answer.find({ questionId })
    .select("answerText voteCount")
    .sort({ voteCount: -1, createdAt: 1 })
    .lean();

  if (answers.length < MIN_ANSWERS_TO_SUMMARIZE) {
    throw createAppError(
      `At least ${MIN_ANSWERS_TO_SUMMARIZE} answers are needed to generate a summary`,
      400,
    );
  }

  const text = await callGemini({
    contents: buildSummaryPrompt(question, answers),
    config: {
      systemInstruction: SUMMARY_INSTRUCTION,
      temperature: 0.3,
    },
  });

  return { summary: toPlainText(text) };
};
