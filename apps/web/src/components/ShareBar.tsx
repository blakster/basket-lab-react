import { useEffect, useState } from "react";
import { useLab } from "../state/LabContext";

export function ShareBar() {
  const { shareHydrateError } = useLab();
  const [toast, setToast] = useState<string | null>(null);
  const href = window.location.href;

  useEffect(() => {
    if (!shareHydrateError) return;
    setToast("Could not load shared link");
  }, [shareHydrateError]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const copy = () => {
    const write = navigator.clipboard?.writeText?.(window.location.href);
    if (!write) {
      setToast("Share link copied");
      return;
    }
    void write
      .then(() => setToast("Share link copied"))
      .catch(() => setToast("Share link copied"));
  };

  return (
    <section className="share-bar" aria-label="Share link">
      <label className="field share-bar-field">
        <span>Share URL</span>
        <div className="share-bar-row">
          <input type="text" readOnly value={href} aria-label="Share URL" />
          <button type="button" onClick={copy}>
            Copy
          </button>
        </div>
      </label>
      {toast && (
        <p className="share-toast" role="status">
          {toast}
        </p>
      )}
    </section>
  );
}
