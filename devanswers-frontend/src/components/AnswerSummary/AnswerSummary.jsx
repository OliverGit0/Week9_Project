import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { FaMagic } from 'react-icons/fa';

import {
  fetchAnswerSummary,
  dismissSummary,
  clearSummary,
} from '../../reducers/aiSlice.js';
import './AnswerSummary.css';

const MIN_ANSWERS_TO_SUMMARIZE = 3;

// Fallback for stores that don't register the ai slice (e.g. existing page tests).
const EMPTY_AI_STATE = {};

// "Summarize Answers" button + dismissible summary banner, shown above the answer list.
const AnswerSummary = ({ questionId, answerCount }) => {
  const dispatch = useDispatch();
  const isAuthenticated = useSelector((state) => !!state.user?.userInfo);
  const {
    summary = null,
    summaryLoading = false,
    summaryError = null,
  } = useSelector((state) => state.ai) ?? EMPTY_AI_STATE;

  // Start fresh for each question, and don't leave a summary behind on leave.
  useEffect(() => {
    dispatch(clearSummary());
    return () => dispatch(clearSummary());
  }, [questionId, dispatch]);

  if (!isAuthenticated || answerCount < MIN_ANSWERS_TO_SUMMARIZE) {
    return null;
  }

  // Ignore a summary that belongs to a different question.
  const currentSummary = summary?.questionId === questionId ? summary.text : null;

  if (currentSummary) {
    return (
      <Alert
        variant="info"
        dismissible
        onClose={() => dispatch(dismissSummary())}
        closeLabel="Dismiss summary"
        className="asum-banner mb-3"
        role="region"
        aria-label="AI answer summary"
      >
        <div className="asum-banner-header">
          <FaMagic className="me-2" aria-hidden="true" />
          AI summary of {answerCount} answers
        </div>
        <p className="asum-banner-text mb-0">{currentSummary}</p>
      </Alert>
    );
  }

  return (
    <div className="mb-3">
      {summaryError && (
        <Alert variant="danger" className="mb-2">
          {summaryError}
        </Alert>
      )}
      <Button
        type="button"
        variant="outline-primary"
        className="asum-btn"
        onClick={() => dispatch(fetchAnswerSummary(questionId))}
        disabled={summaryLoading}
      >
        {summaryLoading ? (
          <>
            <Spinner animation="border" size="sm" className="me-2" aria-hidden="true" />
            Summarizing...
          </>
        ) : (
          <>
            <FaMagic className="me-2" aria-hidden="true" />
            Summarize Answers
          </>
        )}
      </Button>
    </div>
  );
};

export default AnswerSummary;
