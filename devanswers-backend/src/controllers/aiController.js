import { improveQuestionService, summarizeAnswersService } from "../services/aiService.js";
import { createAppError } from "../utils/createAppError.js";

export const improveQuestion = async (req, res) => {
    const { title, description, tags = "" } = req.body;

    if (typeof title !== "string" || !title.trim() ||
        typeof description !== "string" || !description.trim()) {
        throw createAppError("Title and description are required", 400);
    }

    const suggestions = await improveQuestionService({
        title: title.trim(),
        description: description.trim(),
        tags: typeof tags === "string" ? tags.trim() : "",
    });

    res.status(200).json({
        success: true,
        message: "Question improvements generated successfully",
        data: suggestions,
    });
};

export const summarizeAnswers = async (req, res) => {
    const { questionId } = req.params;

    const result = await summarizeAnswersService(questionId);

    res.status(200).json({
        success: true,
        message: "Answer summary generated successfully",
        data: result,
    });
};
