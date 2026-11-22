import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { FaPaperPlane, FaMagic } from 'react-icons/fa';

import { postQuestion } from '../../reducers/questionSlice.js';
import {
  fetchQuestionImprovements,
  dismissSuggestion,
  clearSuggestions,
} from '../../reducers/aiSlice.js';
import AISuggestion from '../../components/AISuggestion/AISuggestion.jsx';

import { Col, Container, Form, Button, Card, Row, Alert, Spinner } from 'react-bootstrap';
import './PostQuestion.css';

const NO_SUGGESTIONS = { title: null, description: null, tags: null };

const PostQuestion = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  const navigate = useNavigate();
  const dispatch = useDispatch();
  // Fall back to an empty AI state so the page still renders in stores
  // that don't register the ai slice (e.g. existing page tests).
  const {
    suggestions = NO_SUGGESTIONS,
    loading: aiLoading = false,
    error: aiError = null,
  } = useSelector((state) => state.ai) ?? {};

  // Don't leave stale suggestions behind when the user leaves the page.
  useEffect(() => {
    dispatch(clearSuggestions());
    return () => dispatch(clearSuggestions());
  }, [dispatch]);

  const fieldSetters = {
    title: setTitle,
    description: setDescription,
    tags: setTags,
  };

  const canImprove = title.trim() !== '' && description.trim() !== '';

  const handleImprove = () => {
    dispatch(fetchQuestionImprovements({ title, description, tags }));
  };

  const handleAcceptSuggestion = (field) => {
    fieldSetters[field](suggestions[field]);
    dispatch(dismissSuggestion(field));
  };

  const handleRejectSuggestion = (field) => {
    dispatch(dismissSuggestion(field));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const result = await dispatch(postQuestion({ title, description, tags }));

      if (postQuestion.fulfilled.match(result)) {
        const newQuestion = result.payload;
        alert('Question posted successfully!');
        navigate(`/question/${newQuestion._id}`);
      }
    } catch (error) {
      console.error('Error posting question:', error);
      alert('Failed to post question. Please try again.');
    }
  };

  const renderSuggestion = (field, label) => (
    <AISuggestion
      field={field}
      label={label}
      suggestion={suggestions[field]}
      onAccept={() => handleAcceptSuggestion(field)}
      onReject={() => handleRejectSuggestion(field)}
    />
  );

  return (
    <Container className="py-3 px-2 py-sm-4 px-sm-3 pq-page-container">
      <Row className="justify-content-center">
         <Col xs={12} lg={10} xl={9}>
            <Card className="mb-4 pq-header-card">
              <Card.Body className="p-3 p-sm-4">
                  <Card.Title as="h2" className="pq-title">
                    Ask a Question
                  </Card.Title>
                  <p className="text-muted mb-0">Be specific and imagine you're asking another person</p>
              </Card.Body>
            </Card>

            <Card className="pq-body-card">
              <Card.Body className="p-3 p-sm-4">
                <Form onSubmit={handleSubmit}>
                  <Form.Group className="mb-4">
                    <Form.Label htmlFor="title" className="pq-label">
                      Title
                    </Form.Label>
                    <Form.Control
                      type="text"
                      id="title"
                      name="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="What's your programming question?"
                      required
                      className="pq-input"
                    />
                    {renderSuggestion('title', 'Title')}
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label htmlFor="description" className="pq-label">
                      Description
                    </Form.Label>
                    <Form.Control
                      as="textarea"
                      id="description"
                      name="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide more details about your question..."
                      rows={10}
                      required
                      className="pq-textarea"
                    />
                    {renderSuggestion('description', 'Description')}
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label htmlFor="tags" className="pq-label">
                      Tags (comma-separated)
                    </Form.Label>
                    <Form.Control
                      type="text"
                      id="tags"
                      name="tags"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="e.g., javascript, react, css"
                      className="pq-input"
                    />
                    <Form.Text className="text-muted">
                      Add up to 5 tags to describe what your question is about
                    </Form.Text>
                    {renderSuggestion('tags', 'Tags')}
                  </Form.Group>

                  {aiError && (
                    <Alert variant="danger" className="mb-3">
                      {aiError}
                    </Alert>
                  )}

                  <Button
                    type="button"
                    variant="outline-primary"
                    size="lg"
                    className="w-100 mb-3 pq-ai-btn"
                    onClick={handleImprove}
                    disabled={!canImprove || aiLoading}
                    title={canImprove ? undefined : 'Fill in a title and description first'}
                  >
                    {aiLoading ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" aria-hidden="true" />
                        Generating suggestions...
                      </>
                    ) : (
                      <>
                        <FaMagic className="me-2" />
                        Improve with AI
                      </>
                    )}
                  </Button>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-100 pq-btn"
                  >
                    <FaPaperPlane className="me-2" />
                    Post Question
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          </Col>
        </Row>
    </Container>
  );
};

export default PostQuestion;
