import { createContext, useCallback, useContext, useEffect, useState } from "react";
import "./toast.css";

const ToastContext = createContext(null);

let externalShowToast = null;

export function toast(message, type = "error") {
  if (externalShowToast) {
    externalShowToast(message, type);
    return;
  }
  console.warn("[toast]", type, message);
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export default function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const showToast = useCallback((message, type = "error") => {
    const text = String(message || "").trim();
    if (!text) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id, message: text, type }]);

    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    externalShowToast = showToast;
    return () => {
      externalShowToast = null;
    };
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, toast: showToast }}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast-item toast-item--${item.type}`} role="status">
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
