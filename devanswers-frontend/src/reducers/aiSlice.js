import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { improveQuestion, summarizeAnswers } from "../services/aiService.js";

const initialSuggestions = {
  title: null,
  description: null,
  tags: null,
};

const initialState = {
  // Question Quality Improver: each suggestion is a string, or null once it
  // has been accepted/rejected (or before any have been requested).
  suggestions: initialSuggestions,
  loading: false,
  error: null,

  // Answer Summarizer: { questionId, text } while a summary is shown, else null.
  summary: null,
  summaryLoading: false,
  summaryError: null,
};

export const fetchQuestionImprovements = createAsyncThunk(
  "ai/fetchQuestionImprovements",
  async ({ title, description, tags }, { getState, rejectWithValue }) => {
    try {
      const { token } = getState().user.userInfo || {};
      return await improveQuestion({ title, description, tags }, token);
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to get AI suggestions",
      );
    }
  },
);

export const fetchAnswerSummary = createAsyncThunk(
  "ai/fetchAnswerSummary",
  async (questionId, { getState, rejectWithValue }) => {
    try {
      const { token } = getState().user.userInfo || {};
      return await summarizeAnswers(questionId, token);
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          "Failed to summarize answers",
      );
    }
  },
);

const aiSlice = createSlice({
  name: "ai",
  initialState,
  reducers: {
    // Removes a single suggestion from display (used by both accept and reject).
    dismissSuggestion: (state, action) => {
      if (action.payload in state.suggestions) {
        state.suggestions[action.payload] = null;
      }
    },
    clearSuggestions: (state) => {
      state.suggestions = initialSuggestions;
      state.loading = false;
      state.error = null;
    },
    // Hides the summary banner; the summarize button becomes available again.
    dismissSummary: (state) => {
      state.summary = null;
      state.summaryError = null;
    },
    clearSummary: (state) => {
      state.summary = null;
      state.summaryLoading = false;
      state.summaryError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchQuestionImprovements.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchQuestionImprovements.fulfilled, (state, action) => {
        state.loading = false;
        const { title, description, tags } = action.payload || {};
        state.suggestions = {
          title: title || null,
          description: description || null,
          tags: tags || null,
        };
      })
      .addCase(fetchQuestionImprovements.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || action.error.message;
      })
      .addCase(fetchAnswerSummary.pending, (state) => {
        state.summaryLoading = true;
        state.summaryError = null;
      })
      .addCase(fetchAnswerSummary.fulfilled, (state, action) => {
        state.summaryLoading = false;
        state.summary = {
          questionId: action.meta.arg,
          text: action.payload?.summary || "",
        };
      })
      .addCase(fetchAnswerSummary.rejected, (state, action) => {
        state.summaryLoading = false;
        state.summaryError = action.payload || action.error.message;
      });
  },
});

export const {
  dismissSuggestion,
  clearSuggestions,
  dismissSummary,
  clearSummary,
} = aiSlice.actions;

export default aiSlice.reducer;
