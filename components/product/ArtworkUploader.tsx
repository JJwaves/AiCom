"use client";

import { useId, useRef, useState } from "react";
import { ARTWORK_ACCEPT, validateArtworkFile } from "@/lib/validation/artwork";
import type { ArtworkRef } from "@/types/commerce";

/**
 * Accessible artwork uploader. Validates type + size client-side, keeps an
 * object URL for preview, and reports an ArtworkRef upward. The file itself
 * is associated with the order at checkout (see lib/commerce).
 */
export function ArtworkUploader({
  value,
  onChange,
}: {
  value: ArtworkRef | null;
  onChange: (ref: ArtworkRef | null) => void;
}) {
  const inputId = useId();
  const notesId = useId();
  const errId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const check = validateArtworkFile(file);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setError(null);
    onChange({
      fileName: file.name,
      fileType: file.type || file.name.split(".").pop() || "unknown",
      fileSizeBytes: file.size,
      url: URL.createObjectURL(file),
      notes: value?.notes,
    });
  };

  return (
    <div>
      <label htmlFor={inputId} className="label-mono mb-2 block">
        Upload your logo or artwork
      </label>

      <div
        role="button"
        tabIndex={0}
        aria-describedby={error ? errId : undefined}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed px-4 py-6 text-center transition-colors ${
          dragOver ? "border-accent bg-accent-soft" : "border-rule-2 bg-paper-2 hover:border-ink-3"
        }`}
      >
        {value ? (
          <>
            <span className="font-mono text-sm text-ink">{value.fileName}</span>
            <span className="text-xs text-ok" role="status">
              ✓ Ready — we&apos;ll send a proof before production
            </span>
            <button
              type="button"
              className="mt-1 text-xs text-ink-3 underline hover:text-error"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Remove file
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-ink-2">Drop a file or click to browse</span>
            <span className="text-xs text-ink-3">PNG, JPG, PDF, SVG, AI or EPS · up to 25 MB</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ARTWORK_ACCEPT}
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error && (
        <p id={errId} role="alert" className="mt-2 rounded-[6px] bg-error-soft px-3 py-2 text-xs text-error">
          {error}
        </p>
      )}

      <label htmlFor={notesId} className="label-mono mb-1 mt-3 block">
        Artwork notes <span className="normal-case tracking-normal text-ink-3">(optional)</span>
      </label>
      <textarea
        id={notesId}
        className="input min-h-16 resize-y text-sm"
        placeholder="Placement, ink color, sizing — anything our artwork team should know."
        value={value?.notes ?? ""}
        onChange={(e) => value && onChange({ ...value, notes: e.target.value })}
        disabled={!value}
      />
      {!value && <p className="mt-1 text-xs text-ink-3">Add a file first, then notes.</p>}
    </div>
  );
}
