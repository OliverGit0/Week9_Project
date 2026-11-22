import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import AnswerSummary from '../../src/components/AnswerSummary/AnswerSummary';
import aiReducer from '../../src/reducers/aiSlice';

const BASE = 'http://localhost:3000/api/ai/summarize-answers';
const SUMMARY_TEXT =
  'Most answers recommend structuredClone. JSON round-tripping loses Dates. Lodash cloneDeep is an alternative.';

const renderSummary = ({ answerCount = 3, loggedIn = true, questionId = 'q1' } = {}) => {
  const store = configureStore({
    reducer: {
      ai: aiReducer,
      user: () => ({
        userInfo: loggedIn ? { userId: 'u1', token: 'tok' } : null,
      }),
    },
  });
  const utils = render(
    <Provider store={store}>
      <AnswerSummary questionId={questionId} answerCount={answerCount} />
    </Provider>,
  );
  return { store, ...utils };
};

const summarizeButton = () => screen.queryByRole('button', { name: /summarize answers/i });

describe('Answer Summarizer', () => {
  let requests;

  beforeEach(() => {
    requests = [];
    server.use(
      http.post(`${BASE}/:questionId`, ({ request, params }) => {
        requests.push({ questionId: params.questionId, auth: request.headers.get('Authorization') });
        return HttpResponse.json({ success: true, data: { summary: SUMMARY_TEXT } });
      }),
    );
  });

  it('shows the button for logged-in users when there are 3 or more answers', () => {
    renderSummary({ answerCount: 3 });
    expect(summarizeButton()).toBeInTheDocument();
  });

  it('hides the button when there are fewer than 3 answers', () => {
    renderSummary({ answerCount: 2 });
    expect(summarizeButton()).not.toBeInTheDocument();
  });

  it('hides the button when the user is not logged in', () => {
    renderSummary({ answerCount: 5, loggedIn: false });
    expect(summarizeButton()).not.toBeInTheDocument();
  });

  it('requests a summary in one call and shows it in a banner instead of the button', async () => {
    const user = userEvent.setup();
    renderSummary({ answerCount: 4, questionId: 'q42' });

    await user.click(summarizeButton());

    const banner = await screen.findByRole('region', { name: /ai answer summary/i });
    expect(banner).toHaveTextContent(SUMMARY_TEXT);
    expect(summarizeButton()).not.toBeInTheDocument();
    expect(requests).toEqual([{ questionId: 'q42', auth: 'Bearer tok' }]);
  });

  it('dismissing the banner hides it and brings the button back so it can be regenerated', async () => {
    const user = userEvent.setup();
    renderSummary();

    await user.click(summarizeButton());
    await screen.findByRole('region', { name: /ai answer summary/i });

    await user.click(screen.getByRole('button', { name: /dismiss summary/i }));

    expect(screen.queryByRole('region', { name: /ai answer summary/i })).not.toBeInTheDocument();
    expect(summarizeButton()).toBeInTheDocument();

    // Regenerate
    await user.click(summarizeButton());
    await screen.findByRole('region', { name: /ai answer summary/i });
    expect(requests).toHaveLength(2);
  });

  it('shows an error and keeps the button when summarizing fails', async () => {
    server.use(
      http.post(`${BASE}/:questionId`, () =>
        HttpResponse.json(
          { success: false, message: 'AI service is busy, please try again shortly' },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderSummary();

    await user.click(summarizeButton());

    expect(await screen.findByText(/ai service is busy/i)).toBeInTheDocument();
    expect(summarizeButton()).toBeEnabled();
  });

  it('does not show a summary from another question', async () => {
    const user = userEvent.setup();
    const { store, rerender } = renderSummary({ questionId: 'q1' });
    await user.click(summarizeButton());
    await screen.findByRole('region', { name: /ai answer summary/i });

    rerender(
      <Provider store={store}>
        <AnswerSummary questionId="q2" answerCount={3} />
      </Provider>,
    );

    expect(screen.queryByRole('region', { name: /ai answer summary/i })).not.toBeInTheDocument();
    expect(summarizeButton()).toBeInTheDocument();
  });
});
