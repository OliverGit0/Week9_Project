import axiosInstance from "../api/axiosInstance.js";
import { AI_API } from "../config/config.js";

// Sends the draft title, description and tags in one request and
// resolves to { title, description, tags } with AI-improved versions.
export const improveQuestion = async ({ title, description, tags }, token) => {
  const res = await axiosInstance.post(
    AI_API.IMPROVE_QUESTION,
    { title, description, tags },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data.data;
};

// Asks the backend to summarise all answers to a question in one Gemini call.
// The backend loads the question and answers itself; resolves to { summary }.
export const summarizeAnswers = async (questionId, token) => {
  const res = await axiosInstance.post(
    AI_API.SUMMARIZE_ANSWERS(questionId),
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data.data;
};
