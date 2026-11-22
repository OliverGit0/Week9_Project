import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import PostQuestion from '../../src/pages/Question/PostQuestion';
import questionReducer from '../../src/reducers/questionSlice';
import aiReducer from '../../src/reducers/aiSlice';

const IMPROVE_URL = 'http://localhost:3000/api/ai/improve-question';
const CREATE_URL = 'http://localhost:3000/api/questions';

const improved = {
  title: 'Why does useEffect run twice on mount in React 18?',
  description: 'My useEffect callback runs twice when the component mounts.',
  tags: 'react, react-hooks, javascript',
};

const createStore = () =>
  configureStore({
    reducer: {
      question: questionReducer,
      ai: aiReducer,
      user: () => ({ userInfo: { userId: 'user-1', token: 'tok' }, loading: false, error: null }),
    },
  });

const renderPage = () => {
  const store = createStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <PostQuestion />
      </MemoryRouter>
    </Provider>,
  );
  return store;
};

const fillDraft = async (user) => {
  await user.type(screen.getByLabelText('Title'), 'react not working');
  await user.type(screen.getByLabelText('Description'), 'useEffect runs twice');
  await user.type(screen.getByLabelText('Tags (comma-separated)'), 'react');
};

describe('Question Quality Improver', () => {
  let requests;

  beforeEach(() => {
    requests = [];
    server.use(
      http.post(IMPROVE_URL, async ({ request }) => {
        requests.push({ body: await request.json(), auth: request.headers.get('Authorization') });
        return HttpResponse.json({ success: true, data: improved });
      }),
    );
  });

  it('disables the improve button until title and description are filled', async () => {
    const user = userEvent.setup();
    renderPage();
    const btn = screen.getByRole('button', { name: /improve with ai/i });
    expect(btn).toBeDisabled();

    await fillDraft(user);
    expect(btn).toBeEnabled();
  });

  it('sends all three fields in one call and shows each suggestion under its field', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: /improve with ai/i }));

    expect(await screen.findByTestId('ai-suggestion-title')).toHaveTextContent(improved.title);
    expect(screen.getByTestId('ai-suggestion-description')).toHaveTextContent(improved.description);
    expect(screen.getByTestId('ai-suggestion-tags')).toHaveTextContent(improved.tags);

    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      title: 'react not working',
      description: 'useEffect runs twice',
      tags: 'react',
    });
    expect(requests[0].auth).toBe('Bearer tok');

    // Each suggestion is rendered directly after its own input
    const titleInput = screen.getByLabelText('Title');
    expect(titleInput.parentElement).toContainElement(screen.getByTestId('ai-suggestion-title'));
    const tagsInput = screen.getByLabelText('Tags (comma-separated)');
    expect(tagsInput.parentElement).toContainElement(screen.getByTestId('ai-suggestion-tags'));
  });

  it('accepting replaces the field and removes only that suggestion', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: /improve with ai/i }));
    await screen.findByTestId('ai-suggestion-title');

    await user.click(screen.getByRole('button', { name: /accept suggested title/i }));

    expect(screen.getByLabelText('Title')).toHaveValue(improved.title);
    expect(screen.queryByTestId('ai-suggestion-title')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-suggestion-description')).toBeInTheDocument();
    expect(screen.getByTestId('ai-suggestion-tags')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('useEffect runs twice');
  });

  it('rejecting dismisses the suggestion without changing the field', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: /improve with ai/i }));
    await screen.findByTestId('ai-suggestion-tags');

    await user.click(screen.getByRole('button', { name: /reject suggested tags/i }));

    expect(screen.getByLabelText('Tags (comma-separated)')).toHaveValue('react');
    expect(screen.queryByTestId('ai-suggestion-tags')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-suggestion-title')).toBeInTheDocument();
  });

  it('allows submitting the form while suggestions are still pending', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    let posted;
    server.use(
      http.post(CREATE_URL, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ data: { _id: 'q-new', ...posted } }, { status: 201 });
      }),
    );

    renderPage();
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: /improve with ai/i }));
    await screen.findByTestId('ai-suggestion-title');
    await user.click(screen.getByRole('button', { name: /accept suggested description/i }));

    await user.click(screen.getByRole('button', { name: /post question/i }));

    await waitFor(() => expect(posted).toBeDefined());
    expect(posted).toMatchObject({
      title: 'react not working',
      description: improved.description,
      tags: 'react',
    });
  });

  it('shows an error message when the AI request fails', async () => {
    server.use(
      http.post(IMPROVE_URL, () =>
        HttpResponse.json(
          { success: false, message: 'AI service is busy, please try again shortly' },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: /improve with ai/i }));

    expect(await screen.findByText(/ai service is busy/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ai-suggestion-title')).not.toBeInTheDocument();
  });
});
