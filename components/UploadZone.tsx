"use client";

import { useCallback, useState, useRef } from "react";

interface UploadZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  disabled?: boolean;
}

export default function UploadZone({
  onFile,
  accept = ".xlsx,.xls,.xlsm,.csv",
  label = "Drop an Excel file here, or click to browse",
  disabled = false,
}: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
      // Reset so same file can be re-uploaded
      e.target.value = "";
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        flex min-h-[120px] cursor-pointer flex-col items-center justify-center
        rounded-xl border-2 border-dashed p-6 text-center transition-colors
        ${disabled ? "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60" : ""}
        ${dragOver ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50 hover:bg-zinc-50"}
      `}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="mb-2 text-[var(--color-text-muted)]"
      >
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />
    </div>
  );
}
