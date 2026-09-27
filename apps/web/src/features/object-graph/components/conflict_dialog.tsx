/**
 * @fileoverview 412 PRECONDITION_FAILED dialog (前端详细设计 §并发控制):
 * 「内容已在其他窗口修改」 with 「刷新并放弃我的修改」 and 「查看差异」. Used by
 * object edits and actions, the ontology workbench and automations.
 */

import {GitCompare, RefreshCw} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';

/** One differing field. */
export interface DiffRow {
  key: string;
  mine: string;
  theirs: string;
}

/** Computes the differing top-level fields of two values. */
export function diffRows(
  mine: Record<string, unknown> | undefined,
  theirs: Record<string, unknown> | undefined,
): DiffRow[] {
  const keys = new Set([
    ...Object.keys(mine ?? {}),
    ...Object.keys(theirs ?? {}),
  ]);
  const show = (v: unknown) =>
    v === undefined || v === null
      ? '—'
      : typeof v === 'string'
        ? v
        : JSON.stringify(v);
  return [...keys]
    .filter(k => JSON.stringify(mine?.[k]) !== JSON.stringify(theirs?.[k]))
    .map(k => ({key: k, mine: show(mine?.[k]), theirs: show(theirs?.[k])}));
}

/** Conflict dialog. `loadTheirs` fetches the current server value for the diff. */
export function ConflictDialog({
  open,
  onOpenChange,
  onRefresh,
  mine,
  loadTheirs,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Discards local edits and reloads the server state. */
  onRefresh(): void;
  mine?: Record<string, unknown>;
  loadTheirs?: () => Promise<Record<string, unknown> | undefined>;
}) {
  const {t} = useTranslation('objects');
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const showDiff = async () => {
    if (!loadTheirs) return;
    setLoading(true);
    try {
      setRows(diffRows(mine, await loadTheirs()));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) setRows(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={t('conflict.title')}
        description={t('conflict.description')}
        footer={
          <>
            {loadTheirs && (
              <Button onClick={() => void showDiff()} loading={loading}>
                <GitCompare aria-hidden />
                {t('conflict.diff')}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                setRows(null);
                onRefresh();
                onOpenChange(false);
              }}
            >
              <RefreshCw aria-hidden />
              {t('conflict.refresh')}
            </Button>
          </>
        }
      >
        {rows && (
          <table className="w-full text-sm" aria-label={t('conflict.diff')}>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-2 font-medium">{t('conflict.field')}</th>
                <th className="py-1 pr-2 font-medium">{t('conflict.mine')}</th>
                <th className="py-1 font-medium">{t('conflict.theirs')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-xs text-dim">
                    {t('conflict.same')}
                  </td>
                </tr>
              )}
              {rows.map(r => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-1.5 pr-2 font-mono text-xs">{r.key}</td>
                  <td className="py-1.5 pr-2 break-all text-orange">
                    {r.mine}
                  </td>
                  <td className="py-1.5 break-all text-cyan">{r.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
