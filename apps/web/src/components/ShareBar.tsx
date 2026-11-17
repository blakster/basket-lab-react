import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { encodeShare } from "../lib/shareUrl";
import { useLab } from "../state/LabContext";

export function ShareBar() {
  const { shareHydrateError, settings, baskets, workspace } = useLab();
  const [toast, setToast] = useState<string | null>(null);
  const href = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", encodeShare({ settings, baskets }));
    return url.href;
  }, [settings, baskets, workspace]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const copy = () => {
    const write = navigator.clipboard?.writeText?.(href);
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
      <h2>Share this setup</h2>
      <p className="share-note">
        A link to your baskets, weights, and investment settings.
      </p>
      {shareHydrateError && (
        <p className="share-error" role="alert">
          Could not load the shared link; the default setup was loaded.
        </p>
      )}
      <div className="field share-bar-field">
        <span id="share-url-label">Share URL</span>
        <div className="share-bar-row">
          <Input
            type="text"
            readOnly
            value={href}
            aria-labelledby="share-url-label"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            className="share-copy"
            onClick={copy}
          >
            Copy link
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
