/**
 * @fileoverview Lightweight toast notifications (aria-live region).
 */

import {AlertOctagon, CheckCircle2, Info, X} from 'lucide-react';
import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {create} from 'zustand';
import {cn} from '../lib/cn';

/** Toast tone. */
export type ToastTone = 'info' | 'success' | 'error';

/** One toast. */
export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs: number;
}

interface ToastState {
  items: ToastItem[];
  push(t: Omit<ToastItem, 'id' | 'durationMs'> & {durationMs?: number}): number;
  dismiss(id: number): void;
}

let nextId = 1;

/** Toast store. */
export const useToastStore = create<ToastState>(set => ({
  items: [],
  push(t) {
    const id = nextId++;
    set(s => ({items: [...s.items.slice(-4), {durationMs: 5000, ...t, id}]}));
    return id;
  },
  dismiss(id) {
    set(s => ({items: s.items.filter(i => i.id !== id)}));
  },
}));

/** Shows a toast. */
export const toast = {
  info: (title: string, description?: string) =>
    useToastStore.getState().push({tone: 'info', title, description}),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({tone: 'success', title, description}),
  error: (title: string, description?: string) =>
    useToastStore
      .getState()
      .push({tone: 'error', title, description, durationMs: 8000}),
};

function ToastView({item}: {item: ToastItem}) {
  const {t} = useTranslation('common');
  const dismiss = useToastStore(s => s.dismiss);
  useEffect(() => {
    const id = setTimeout(() => dismiss(item.id), item.durationMs);
    return () => clearTimeout(id);
  }, [item.id, item.durationMs, dismiss]);
  const Icon =
    item.tone === 'success'
      ? CheckCircle2
      : item.tone === 'error'
        ? AlertOctagon
        : Info;
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'glass pointer-events-auto flex w-80 items-start gap-2.5 !bg-panel-solid px-3.5 py-3 text-sm',
        item.tone === 'error' && 'border-crit/50',
        item.tone === 'success' && 'border-good/40',
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-4 shrink-0',
          item.tone === 'error'
            ? 'text-crit'
            : item.tone === 'success'
              ? 'text-good'
              : 'text-cyan',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs break-words text-muted">
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="rounded p-0.5 text-dim hover:text-text"
        aria-label={t('actions.close')}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Toast viewport (mounted once). */
export function Toaster() {
  const items = useToastStore(s => s.items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col gap-2"
    >
      {items.map(i => (
        <ToastView key={i.id} item={i} />
      ))}
    </div>
  );
}
