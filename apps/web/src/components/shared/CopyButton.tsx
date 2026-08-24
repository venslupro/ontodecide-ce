/**
 * CopyButton — one-click copy to clipboard.
 * Uses lib/copy, toggles success state for 1500ms.
 */
import { HTMLAttributes, useCallback, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import { copyToClipboard } from '@/lib/copy';

export interface CopyButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick'> {
  text: string;
  copiedLabel?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  onCopied?: () => void;
}

export default function CopyButton({
  text, copiedLabel = 'Copied!', ariaLabel = 'Copy to clipboard',
  size = 'sm', onCopied, className, style, ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 1500);
    }
  }, [text, onCopied]);

  return (
    <IconButton
      size={size}
      variant="outline"
      onClick={onClick}
      aria-label={copied ? copiedLabel : ariaLabel}
      className={className}
      style={style}
      {...(rest as any)}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <polyline
            points="4 12 10 18 20 6"
            fill="none"
            stroke="var(--color-success)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2"
            fill="none" stroke="currentColor" strokeWidth="1.8"/>
          <path d="M5 15V6a2 2 0 0 1 2-2h9"
            fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      )}
    </IconButton>
  );
}
