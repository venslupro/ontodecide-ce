/**
 * @fileoverview Six-box one-time code input (前端详细设计 6.11 注册与登录,
 * 表 14 `.otp`): digits only, whole-code paste into any box, iOS / Android
 * SMS-mail autofill through `autocomplete="one-time-code"` on the first box,
 * Backspace / arrow navigation.
 */

import {
  useEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {cn} from '../lib/cn';

/** Number of digits of an e-mail code. */
export const OTP_LENGTH = 6;

/** Extracts up to `len` digits from arbitrary text. */
export function otpDigits(text: string, len = OTP_LENGTH): string {
  return text.replace(/\D/g, '').slice(0, len);
}

/** OTP input props. */
export interface OtpInputProps {
  value: string;
  onChange(value: string): void;
  /** Called when all digits are filled. */
  onComplete?(value: string): void;
  /** Accessible label of the group (e.g. "6 位验证码"). */
  label: string;
  /** Per-box label, receives the 1-based index. */
  boxLabel?(index: number): string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  className?: string;
  /** id of an element describing the input (error text). */
  describedBy?: string;
}

/** Six single-digit boxes behaving as one field. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  label,
  boxLabel,
  invalid,
  disabled,
  autoFocus,
  length = OTP_LENGTH,
  className,
  describedBy,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = otpDigits(value, length);

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(digits.length, length - 1)]?.focus();
    // Focus only on mount.
  }, []);

  const commit = (next: string, focusIndex: number) => {
    const v = otpDigits(next, length);
    onChange(v);
    refs.current[Math.max(0, Math.min(length - 1, focusIndex))]?.focus();
    if (v.length === length) onComplete?.(v);
  };

  const setAt = (i: number, raw: string) => {
    const incoming = otpDigits(raw, length);
    if (!incoming) return;
    if (incoming.length > 1) {
      // Autofill or typing fast: spread from this box.
      const next = (digits.slice(0, i) + incoming).slice(0, length);
      commit(next, next.length);
      return;
    }
    const arr = digits.padEnd(length, ' ').split('');
    arr[i] = incoming;
    const next = arr.join('').replace(/\s+$/, '').replace(/\s/g, '');
    commit(next, i + 1);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        commit(digits.slice(0, i) + digits.slice(i + 1), i);
      } else if (i > 0) {
        commit(digits.slice(0, i - 1) + digits.slice(i), i - 1);
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = otpDigits(e.clipboardData.getData('text'), length);
    if (!text) return;
    e.preventDefault();
    commit(text, text.length);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn('flex gap-2.5', className)}
    >
      {Array.from({length}, (_, i) => (
        <input
          key={i}
          ref={el => {
            refs.current[i] = el;
          }}
          className="otp-box"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={i === 0 ? length : 1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={boxLabel ? boxLabel(i + 1) : `${label} ${i + 1}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={digits[i] ?? ''}
          onChange={e => setAt(i, e.target.value)}
          onKeyDown={e => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={e => e.target.select()}
        />
      ))}
    </div>
  );
}
