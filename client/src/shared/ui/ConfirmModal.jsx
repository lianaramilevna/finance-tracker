import { FiX } from "react-icons/fi";
import "./confirm-modal.css";

function ConfirmModal({
  open,
  title,
  description,
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-head">
          <h3>{title}</h3>
          <button type="button" className="confirm-modal-close" onClick={onClose}>
            <FiX size={18} />
          </button>
        </div>
        {description && <p className="confirm-modal-text">{description}</p>}
        <div className="confirm-modal-actions">
          <button type="button" className="confirm-modal-secondary" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`confirm-modal-confirm${danger ? " danger" : ""}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;

