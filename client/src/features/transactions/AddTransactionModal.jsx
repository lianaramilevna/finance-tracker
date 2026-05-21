import AddTransaction from "./AddTransaction";
import "./transaction-modal.css";

function AddTransactionModal({ isOpen, onClose, onAdd }) {
  if (!isOpen) return null;

  return (
    <div className="transaction-modal-overlay" onClick={onClose}>
      <div
        className="transaction-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="transaction-modal-header">
          <h2>Добавить транзакцию</h2>
          <button className="close-btn" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <AddTransaction onAdd={onAdd} onCancel={onClose} />
      </div>
    </div>
  );
}

export default AddTransactionModal;