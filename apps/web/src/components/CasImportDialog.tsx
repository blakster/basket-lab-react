import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, FileText, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CAS_FILE_REJECT_MESSAGE,
  casFileRejected,
  importCas,
  type CasImportResult,
} from "../lib/api/portfolio";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (summary: string) => void;
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function summarizeImport(result: CasImportResult): string {
  const parts: string[] = [];
  if (result.imported > 0 || result.snapshotsWritten === 0) {
    parts.push(
      `Imported ${result.imported} transaction${result.imported === 1 ? "" : "s"}`,
    );
  }
  if (result.snapshotsWritten > 0) {
    const label = `${result.snapshotsWritten} holding snapshot${result.snapshotsWritten === 1 ? "" : "s"}`;
    parts.push(parts.length === 0 ? `Imported ${label}` : label);
  }
  if (result.duplicates > 0) parts.push(`${result.duplicates} already known`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.warnings?.length) {
    parts.push(
      `${result.warnings.length} parser warning${result.warnings.length === 1 ? "" : "s"}`,
    );
  }
  return `${parts.join(", ")}.`;
}

export function CasImportDialog({ open, onOpenChange, onImported }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setPassword("");
    setShowPassword(false);
    setDragging(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && importMutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const acceptFile = (picked: File | null) => {
    if (!picked) {
      setFile(null);
      setError(null);
      return;
    }
    if (casFileRejected(picked)) {
      setError(CAS_FILE_REJECT_MESSAGE);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(picked);
  };

  const importMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a CAS PDF first.");
      return importCas(file, password);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      onImported(summarizeImport(result));
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message || "Could not read this statement.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!importMutation.isPending}
        onEscapeKeyDown={(event) => {
          if (importMutation.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (importMutation.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="editor-title">Import CAS statement</DialogTitle>
          <DialogDescription className="editor-description">
            CAMS or KFintech consolidated statement, or an NSDL/CDSL depository
            CAS with mutual funds and stocks. Parsed locally; re-importing the
            same file adds nothing twice.
          </DialogDescription>
        </DialogHeader>
        <form
          className="manual-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            importMutation.mutate();
          }}
        >
          <label
            className={`cas-dropzone${dragging ? " is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              acceptFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Choose CAS PDF"
              onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <span className="cas-dropzone-title inline-flex items-center gap-2">
                  <FileText className="size-4 shrink-0" aria-hidden="true" />
                  {file.name}
                </span>
                <span className="cas-dropzone-sub">
                  {formatFileSize(file.size)} · Click or drop another PDF to replace
                </span>
              </>
            ) : (
              <>
                <span className="cas-dropzone-title inline-flex items-center gap-2">
                  <Upload className="size-4 shrink-0" aria-hidden="true" />
                  Drop CAS PDF here, or browse
                </span>
                <span className="cas-dropzone-sub">
                  Depository statements import closing units, value, and stock
                  symbols; gain and XIRR stay hidden where cost history is absent.
                </span>
              </>
            )}
          </label>

          <label className="manual-field">
            <span>Statement password</span>
            <div className="cas-password-wrap">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Usually your PAN or chosen CAS password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </label>

          {error && (
            <p className="cas-note cas-error" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={importMutation.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!file || importMutation.isPending}>
              {importMutation.isPending ? "Importing…" : "Import statement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
