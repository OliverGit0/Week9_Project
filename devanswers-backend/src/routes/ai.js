import express from 'express';
import { improveQuestion, summarizeAnswers } from '../controllers/aiController.js';
import authenticate from '../middleware/authHandler.js';

const router = express.Router();

// Protected routes - authentication required (each call spends Gemini quota)
router.post('/improve-question', authenticate, improveQuestion);
router.post('/summarize-answers/:questionId', authenticate, summarizeAnswers);

export default router;
