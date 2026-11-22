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
