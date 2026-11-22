import { Button } from 'react-bootstrap';
import { FaCheck, FaTimes, FaMagic } from 'react-icons/fa';
import './AISuggestion.css';

// Inline AI suggestion shown directly beneath a form field.
// Renders nothing when there is no suggestion for the field.
const AISuggestion = ({ field, label, suggestion, onAccept, onReject }) => {
  if (!suggestion) return null;

  return (
    <div
      className="ai-suggestion mt-2"
      role="region"
      aria-label={`AI suggestion for ${label}`}
      data-testid={`ai-suggestion-${field}`}
    >
      <div className="ai-suggestion-header">
        <FaMagic className="me-2" aria-hidden="true" />
        Suggested {label.toLowerCase()}
      </div>
      <div className="ai-suggestion-text">{suggestion}</div>
      <div className="ai-suggestion-actions">
        <Button
          type="button"
          size="sm"
          variant="success"
          onClick={onAccept}
          aria-label={`Accept suggested ${label.toLowerCase()}`}
        >
          <FaCheck className="me-1" aria-hidden="true" />
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline-secondary"
          onClick={onReject}
          aria-label={`Reject suggested ${label.toLowerCase()}`}
        >
          <FaTimes className="me-1" aria-hidden="true" />
          Reject
        </Button>
      </div>
    </div>
  );
};

export default AISuggestion;
