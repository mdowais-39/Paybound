import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  /** The full, untruncated value to copy — never the display text, which may
   * be shortened with an ellipsis. */
  value: string;
  /** What's being copied, used in the tooltip and the sr-only label (e.g.
   * "mandate ID", "cart ID"). */
  label: string;
  className?: string;
}

/** A small click-to-copy icon button — same interaction the audit hash-chain
 * view already used (copy → briefly show a check mark), pulled out into one
 * shared component so every identifier in the app (mandate ID, cart ID,
 * session ID, hash) copies exactly the same way. Swallows a clipboard
 * failure (unsupported browser context, permissions) rather than throwing —
 * copying an ID is a convenience, never something that should surface an
 * error to the user. */
export const CopyButton: React.FC<CopyButtonProps> = ({ value, label, className = "" }) => {
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied/unsupported — copying is a convenience,
      // not a critical action, so this fails silently rather than erroring.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center justify-center text-[#9CA3AF] hover:text-[#111827] transition-colors p-0.5 cursor-pointer shrink-0 ${className}`}
      title={copied ? "Copied!" : `Copy ${label}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[#059669]" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      <span className="sr-only">Copy {label}</span>
    </button>
  );
};
