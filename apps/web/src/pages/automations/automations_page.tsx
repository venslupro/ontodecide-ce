/**
 * @fileoverview 自动化规则 (/automations): alert-only rules (threshold or
 * scheduled every n hours; ≤ 3 scheduled per workspace), with the object
 * type, condition summary, severity, cooldown, last fired / next run, an
 * enable switch (PUT with the full definition and If-Match), edit and
 * delete (confirmation, If-Match). 412 opens the conflict dialog.
 */

import type {AutomationDto} from '@ontodecide/situation/contract';
import {CE_LIMITS, resolveText} from '@ontodecide/shared-kernel';
import {Pencil, Plus, Trash2, Workflow} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {ConflictDialog} from '../../features/object-graph/components/conflict_dialog';
import {
  defOf,
  useAutomations,
  useDeleteAutomation,
  useUpdateAutomation,
} from '../../features/situation/api';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {fmt} from '../../shared/lib/format';
import {Badge, SeverityBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card} from '../../shared/ui/card';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Switch} from '../../shared/ui/switch';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';
import {AutomationDialog} from './automation_dialog';
import {
  conditionSummary,
  cooldownText,
  scheduledCount,
  triggerSummary,
} from './automation_model';

type Editor =
  {open: false} | {open: true; automation?: AutomationDto; key: number};

function When({at, empty}: {at: string | null; empty: string}) {
  if (!at) return <span className="text-dim">{empty}</span>;
  return (
    <time dateTime={at} title={fmt.dateTime(at)}>
      {fmt.ago(at)}
    </time>
  );
}

/** Automations page. */
export function AutomationsPage() {
  const {t, i18n} = useTranslation('automations');
  const {model} = useUiModel();
  const q = useAutomations();
  const update = useUpdateAutomation();
  const del = useDeleteAutomation();
  const [editor, setEditor] = useState<Editor>({open: false});
  const [deleting, setDeleting] = useState<AutomationDto | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [conflict, setConflict] = useState<AutomationDto | null>(null);

  const list = q.data ?? [];
  const nameOf = (a: AutomationDto) => resolveText(a.name, i18n.language, a.id);
  const scheduled = scheduledCount(list);

  const onConflict = (a: AutomationDto) => setConflict(a);

  const toggle = (a: AutomationDto, enabled: boolean) => {
    setToggling(s => ({...s, [a.id]: enabled}));
    update.mutate(
      {id: a.id, def: {...defOf(a), enabled}, version: a.version},
      {
        onSuccess: () =>
          toast.success(enabled ? t('toast.enabled') : t('toast.disabled')),
        onError: e => {
          if (isApiError(e, 'PRECONDITION_FAILED') && e.status === 412)
            onConflict(a);
          else
            toast.error(t('toast.toggleFailed'), errorMessage(e, t), {
              traceId: errorTraceId(e),
            });
        },
        onSettled: () =>
          setToggling(s => {
            const next = {...s};
            delete next[a.id];
            return next;
          }),
      },
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    del.mutate(
      {id: target.id, version: target.version},
      {
        onSuccess: () => {
          toast.success(t('toast.deleted', {name: nameOf(target)}));
          setDeleting(null);
        },
        onError: e => {
          if (isApiError(e, 'PRECONDITION_FAILED') && e.status === 412) {
            setDeleting(null);
            onConflict(target);
          }
        },
      },
    );
  };

  const openCreate = () => setEditor({open: true, key: Date.now()});

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t('title')}
        description={t('description')}
        badges={
          <Badge
            tone={
              scheduled >= CE_LIMITS.maxScheduledAutomations
                ? 'warn'
                : 'neutral'
            }
            className="num"
            data-testid="scheduled-count"
          >
            {t('scheduledCount', {
              used: scheduled,
              max: CE_LIMITS.maxScheduledAutomations,
            })}
          </Badge>
        }
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus aria-hidden />
            {t('actions.create')}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-hidden>
            {Array.from({length: 3}, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorView
            traceId={errorTraceId(q.error)}
            detail={errorMessage(q.error, t)}
            onRetry={() => void q.refetch()}
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Workflow aria-hidden />}
            title={t('empty.title')}
            description={t('empty.hint')}
            action={
              <Button variant="secondary" size="sm" onClick={openCreate}>
                <Plus aria-hidden />
                {t('actions.create')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label={t('title')}>
              <THead>
                <Tr>
                  <Th>{t('col.name')}</Th>
                  <Th>{t('col.trigger')}</Th>
                  <Th>{t('col.objectType')}</Th>
                  <Th>{t('col.condition')}</Th>
                  <Th>{t('col.severity')}</Th>
                  <Th>{t('col.cooldown')}</Th>
                  <Th>{t('col.lastFired')}</Th>
                  <Th>{t('col.nextRun')}</Th>
                  <Th>{t('col.enabled')}</Th>
                  <Th className="text-right">{t('col.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {list.map(a => {
                  const name = nameOf(a);
                  const type = model.byName[a.objectType];
                  const enabled = toggling[a.id] ?? a.enabled;
                  return (
                    <Tr key={a.id} data-testid="automation-row">
                      <Td className="font-medium text-text">{name}</Td>
                      <Td className="text-sm whitespace-nowrap text-muted">
                        {triggerSummary(a, t)}
                      </Td>
                      <Td className="text-sm whitespace-nowrap">
                        {type?.displayName ?? a.objectType}
                      </Td>
                      <Td className="max-w-[22rem] text-sm text-text">
                        {conditionSummary(a.condition, type, t)}
                      </Td>
                      <Td>
                        <SeverityBadge severity={a.severity} />
                      </Td>
                      <Td className="num text-sm whitespace-nowrap text-muted">
                        {cooldownText(a.cooldownSec, t)}
                      </Td>
                      <Td className="text-sm whitespace-nowrap text-muted">
                        <When at={a.lastFiredAt} empty={t('never')} />
                      </Td>
                      <Td className="text-sm whitespace-nowrap text-muted">
                        {a.trigger === 'schedule' ? (
                          a.nextRunAt ? (
                            <time
                              dateTime={a.nextRunAt}
                              title={fmt.dateTime(a.nextRunAt)}
                            >
                              {fmt.shortDateTime(a.nextRunAt)}
                            </time>
                          ) : (
                            <span className="text-dim">{t('pending')}</span>
                          )
                        ) : (
                          <span className="text-dim">{t('onChange')}</span>
                        )}
                      </Td>
                      <Td>
                        <Switch
                          checked={enabled}
                          disabled={a.id in toggling}
                          aria-label={t('toggleLabel', {name})}
                          onCheckedChange={v => toggle(a, v)}
                        />
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('editLabel', {name})}
                          onClick={() =>
                            setEditor({
                              open: true,
                              automation: a,
                              key: Date.now(),
                            })
                          }
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('deleteLabel', {name})}
                          onClick={() => {
                            del.reset();
                            setDeleting(a);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog
        open={editor.open}
        onOpenChange={o => !o && setEditor({open: false})}
      >
        {editor.open && (
          <AutomationDialog
            key={editor.key}
            automation={editor.automation}
            list={list}
            onDone={() => setEditor({open: false})}
          />
        )}
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        {deleting && (
          <DialogContent
            size="sm"
            title={t('delete.title')}
            description={t('delete.confirm', {name: nameOf(deleting)})}
            footer={
              <>
                <Button variant="ghost" onClick={() => setDeleting(null)}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="danger"
                  loading={del.isPending}
                  onClick={confirmDelete}
                >
                  <Trash2 aria-hidden />
                  {t('actions.delete')}
                </Button>
              </>
            }
          >
            {del.error && !isApiError(del.error, 'PRECONDITION_FAILED') ? (
              <p role="alert" className="text-sm text-crit">
                {errorMessage(del.error, t)}
              </p>
            ) : null}
          </DialogContent>
        )}
      </Dialog>

      <ConflictDialog
        open={!!conflict}
        onOpenChange={o => !o && setConflict(null)}
        mine={
          conflict
            ? (defOf(conflict) as unknown as Record<string, unknown>)
            : undefined
        }
        loadTheirs={async () => {
          const r = await q.refetch();
          const fresh = r.data?.find(x => x.id === conflict?.id);
          return fresh
            ? (defOf(fresh) as unknown as Record<string, unknown>)
            : undefined;
        }}
        onRefresh={() => void q.refetch()}
      />
    </div>
  );
}
