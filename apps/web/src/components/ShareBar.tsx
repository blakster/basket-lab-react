import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      setToast("Clipboard unavailable — select the URL and copy it");
      return;
    }
    void write
      .then(() => setToast("Share link copied"))
      .catch(() => setToast("Could not copy — select the URL instead"));
  };

  return (
    <section className="share-bar" aria-label="Share link">
      <h2>Share</h2>
      <div className="field share-bar-field">
        <span id="share-url-label">Share URL</span>
        <div className="share-bar-row">
          <Input
            type="text"
            readOnly
            value={href}
            aria-labelledby="share-url-label"
          />
          <Button
            type="button"
            variant="outline"
            className="share-copy"
            onClick={copy}
          >
            Copy
          </Button>
        </div>
      </div>
      {toast && (
        <p className="share-toast" role="status">
          {toast}
        </p>
      )}
      <p className="share-disclaimer">
        NAVs from TigZig, with MFAPI as fallback. Holdings, expense, and PE come
        from Foliyo Markets — missing figures stay empty, never zero. This is a
        comparison lab, not investment advice.
      </p>
    </section>
  );
}
