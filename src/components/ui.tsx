import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ------------------------------------------------------------------ Modal
export function Modal({
  title, onClose, children, footer, size, headerExtra,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'lg';
  headerExtra?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="dialog-head">
          <h2>{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={onClose} aria-label="Închide">✕</button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------- confirm + toast context
interface ConfirmOpts {
  title?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
}
interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
interface FeedbackApi {
  confirm: (message: ReactNode, opts?: ConfirmOpts) => Promise<boolean>;
  toast: (text: string, action?: Toast['action']) => void;
}

const FeedbackCtx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ message: ReactNode; opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback(
    (message: ReactNode, opts: ConfirmOpts = {}) => new Promise<boolean>((resolve) => setPending({ message, opts, resolve })),
    [],
  );
  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : 3200);
  }, []);

  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <FeedbackCtx.Provider value={{ confirm, toast }}>
      {children}
      {pending && (
        <Modal
          size="sm"
          title={pending.opts.title ?? 'Confirmare'}
          onClose={() => close(false)}
          footer={
            <div className="row">
              <button className="btn" onClick={() => close(false)}>{pending.opts.cancel ?? 'Renunță'}</button>
              <button className={`btn ${pending.opts.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
                {pending.opts.ok ?? 'Da'}
              </button>
            </div>
          }
        >
          <div>{pending.message}</div>
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </FeedbackCtx.Provider>
  );
}

export function useFeedback() {
  const v = useContext(FeedbackCtx);
  if (!v) throw new Error('useFeedback în afara FeedbackProvider');
  return v;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
