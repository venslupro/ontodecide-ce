/**
 * @fileoverview Ontology pack import: built-in / available packs with an
 * "import" action, JSON pack file import (shape validated with the contract
 * schema), a confirm step and a result summary with the published version.
 */

import type {
  OntologyPack,
  PackSummary,
  PublishReport,
} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {useNavigate} from '@tanstack/react-router';
import {
  CheckCircle2,
  FileJson,
  PackageOpen,
  Sparkles,
  Upload,
} from 'lucide-react';
import {useRef, useState, type ChangeEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {cn} from '../../../shared/lib/cn';
import {useOnline} from '../../../shared/lib/hooks';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Panel} from '../../../shared/ui/card';
import {Dialog, DialogClose, DialogContent} from '../../../shared/ui/dialog';
import {EmptyState, ErrorView} from '../../../shared/ui/empty_state';
import {Mono} from '../../../shared/ui/page_header';
import {Skeleton} from '../../../shared/ui/skeleton';
import {toast} from '../../../shared/ui/toast';
import {useImportPack, usePacks} from '../api';
import {parsePackFile} from '../model';

type Pending =
  | {source: 'pack'; summary: PackSummary}
  | {source: 'file'; pack: OntologyPack; fileName: string};

function pendingName(p: Pending, lang: string): string {
  return p.source === 'pack'
    ? resolveText(p.summary.name, lang, p.summary.id)
    : resolveText(p.pack.name, lang, p.pack.id);
}

/** Packs panel with import actions. */
export function PackImportPanel({canWrite}: {canWrite: boolean}) {
  const {t, i18n} = useTranslation('ontology');
  const lang = i18n.language;
  const navigate = useNavigate();
  const online = useOnline();
  const packs = usePacks();
  const importPack = useImportPack();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileIssues, setFileIssues] = useState<{
    fileName: string;
    issues: string[];
  } | null>(null);
  const [result, setResult] = useState<{
    report: PublishReport;
    name: string;
  } | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = parsePackFile(text);
    if (parsed.ok)
      setPending({source: 'file', pack: parsed.pack, fileName: file.name});
    else setFileIssues({fileName: file.name, issues: parsed.issues});
  };

  const confirm = () => {
    if (!pending) return;
    const name = pendingName(pending, lang);
    importPack.mutate(
      pending.source === 'pack'
        ? {packId: pending.summary.id}
        : {pack: pending.pack},
      {
        onSuccess: r => {
          setPending(null);
          setResult({report: r.report, name});
          toast.success(t('packs.imported', {name, version: r.report.version}));
        },
      },
    );
  };

  const sorted = [...(packs.data ?? [])].sort(
    (a, b) => Number(b.builtIn) - Number(a.builtIn),
  );

  return (
    <Panel
      title={t('packs.title')}
      subtitle={t('packs.subtitle')}
      icon={<PackageOpen aria-hidden />}
      actions={
        canWrite && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={e => void onFile(e)}
              data-testid="pack-file-input"
            />
            <Button
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={!online}
            >
              <Upload aria-hidden />
              {t('packs.fromFile')}
            </Button>
          </>
        )
      }
    >
      {packs.isLoading && (
        <div className="grid gap-3">
          <Skeleton className="h-24" />
        </div>
      )}
      {packs.isError && (
        <ErrorView
          detail={errorMessage(packs.error, t)}
          onRetry={() => void packs.refetch()}
        />
      )}
      {packs.data && sorted.length === 0 && (
        <EmptyState title={t('packs.empty')} />
      )}
      <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {sorted.map(p => (
          <li
            key={p.id}
            className={cn(
              'flex flex-col gap-2 rounded-xl border p-3.5',
              p.builtIn
                ? 'border-cyan/40 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--cyan)_10%,transparent),transparent_70%)]'
                : 'border-line bg-panel-2/40',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                  {resolveText(p.name, lang, p.id)}
                  {p.builtIn && (
                    <Badge tone="cyan">
                      <Sparkles aria-hidden />
                      {t('packs.builtIn')}
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-dim">
                  <Mono>{p.id}</Mono> · v{p.version}
                </p>
              </div>
              {canWrite && (
                <Button
                  size="sm"
                  variant={p.builtIn ? 'secondary' : 'outline'}
                  disabled={!online}
                  aria-label={t('packs.importAria', {
                    name: resolveText(p.name, lang, p.id),
                  })}
                  onClick={() => setPending({source: 'pack', summary: p})}
                >
                  {t('common:actions.import')}
                </Button>
              )}
            </div>
            {p.description && (
              <p className="text-sm text-muted">
                {resolveText(p.description, lang)}
              </p>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={!!pending}
        onOpenChange={o => {
          if (o || importPack.isPending) return;
          setPending(null);
          importPack.reset();
        }}
      >
        {pending && (
          <DialogContent
            title={t('packs.confirmTitle', {name: pendingName(pending, lang)})}
            description={t('packs.confirmDescription')}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost">{t('common:actions.cancel')}</Button>
                </DialogClose>
                <Button
                  variant="primary"
                  loading={importPack.isPending}
                  disabled={!online}
                  onClick={confirm}
                >
                  {t('packs.confirmImport')}
                </Button>
              </>
            }
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">{t('packs.id')}</dt>
              <dd>
                <Mono className="text-text">
                  {pending.source === 'pack'
                    ? pending.summary.id
                    : pending.pack.id}
                </Mono>
              </dd>
              <dt className="text-muted">{t('packs.version')}</dt>
              <dd className="text-text">
                {pending.source === 'pack'
                  ? pending.summary.version
                  : pending.pack.version}
              </dd>
              {pending.source === 'file' && (
                <>
                  <dt className="text-muted">{t('packs.file')}</dt>
                  <dd className="flex items-center gap-1.5 text-text">
                    <FileJson className="size-3.5 text-dim" aria-hidden />
                    {pending.fileName}
                  </dd>
                  <dt className="text-muted">{t('packs.contents')}</dt>
                  <dd className="text-text">
                    {t('packs.contentsValue', {
                      objects: pending.pack.schema.objectTypes.length,
                      links: pending.pack.schema.linkTypes.length,
                      actions: pending.pack.schema.actionTypes.length,
                    })}
                  </dd>
                </>
              )}
            </dl>
            <p className="mt-3 text-xs text-dim">{t('packs.confirmHint')}</p>
            {importPack.isError && (
              <p role="alert" className="mt-3 text-sm text-crit">
                {errorMessage(importPack.error, t)}
              </p>
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!fileIssues} onOpenChange={o => !o && setFileIssues(null)}>
        {fileIssues && (
          <DialogContent
            title={t('packs.invalidTitle')}
            description={t('packs.invalidDescription', {
              file: fileIssues.fileName,
            })}
            footer={
              <DialogClose asChild>
                <Button>{t('common:actions.close')}</Button>
              </DialogClose>
            }
          >
            <ul role="alert" className="flex flex-col gap-1 text-sm">
              {fileIssues.issues.map((i, k) => (
                <li key={k} className="font-mono text-xs text-crit">
                  {i}
                </li>
              ))}
            </ul>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!result} onOpenChange={o => !o && setResult(null)}>
        {result && (
          <DialogContent
            title={t('packs.resultTitle')}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost">{t('common:actions.close')}</Button>
                </DialogClose>
                <Button
                  variant="primary"
                  onClick={() => {
                    const api = result.report.apiName;
                    setResult(null);
                    void navigate({to: '/ontology/$api', params: {api}});
                  }}
                >
                  {t('packs.openWorkbench')}
                </Button>
              </>
            }
          >
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-good"
                aria-hidden
              />
              <div className="text-sm">
                <p className="font-medium text-text">
                  {t('packs.resultBody', {
                    name: result.name,
                    api: result.report.apiName,
                    version: result.report.version,
                  })}
                </p>
                <p className="mt-1 text-muted">
                  {t('packs.resultChanges', {
                    changes: result.report.diff.changes.length,
                    indexes: result.report.indexChanges.length,
                  })}
                </p>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Panel>
  );
}
