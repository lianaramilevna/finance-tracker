import { Link } from "react-router-dom";
import "./empty-state.css";

function EmptyState({ title, description, actionLabel, actionTo, onAction }) {
  return (
    <div className="empty-state-block">
      {title && <h3 className="empty-state-title">{title}</h3>}
      {description && <p className="empty-state-desc">{description}</p>}
      {actionLabel && actionTo && (
        <Link to={actionTo} className="empty-state-action">
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && !actionTo && (
        <button type="button" className="empty-state-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
