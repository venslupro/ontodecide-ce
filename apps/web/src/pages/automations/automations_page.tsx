/**
 * @fileoverview 自动化规则: list of automation rules with human-readable
 * trigger / condition / effects, optimistic enable switch, edit (dialog
 * with condition builder and dry run before save) and delete.
 */

import type {AutomationDto} from '@ontodecide/situation/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Pencil, Plus, Sparkles, Trash2, Workflow} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {useHasRole} from '../../entities/session/store';
import {
  useAutomations,
  useDeleteAutomation,
  useSaveAutomation,
} from '../../features/situation/api';
import {errorMessage} from '../../shared/api/error_message';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
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
  defOf,
  triggerObjectType,
  triggerSummary,
} from './automation_model';

/** Editor state: closed, creating, or editing one rule. */
type Editor =
  {open: false} | {open: true; automation?: AutomationDto; key: number};

/** Automations page. */
export function AutomationsPage() {
  const {t, i18n} = useTranslation('cockpit');
  const {model} = useUiModel();
  const q = useAutomations();
  const save = useSaveAutomation();
  const del = useDeleteAutomation();
  const canWrite = useHasRole('Operator');
  const online = useOnline();
  const [editor, setEditor] = useState<Editor>({open: false});
  const [deleting, setDeleting] = useState<AutomationDto | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const nameOf = (a: AutomationDto) => resolveText(a.name, i18n.language, a.id);

  const toggle = (a: AutomationDto, enabled: boolean) => {
    setToggling(s => ({...s, [a.id]: enabled}));
    save.mutate(
      {...defOf(a), enabled},
      {
        onSuccess: () =>
          toast.success(
            enabled
              ? t('automations.enabledToast')
              : t('automations.disabledToast'),
          ),
        onError: e =>
          toast.error(t('automations.toggleFailed'), errorMessage(e, t)),
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
    del.mutate(target.id, {
      onSuccess: () => {
        toast.success(t('automations.deleted'));
        setDeleting(null);
      },
      onError: e => toast.error(errorMessage(e, t)),
    });
  };

  const list = q.data ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t('automations.title')}
        description={t('automations.description')}
        actions={
          canWrite && (
            <Button
              variant="primary"
              disabled={!online}
              onClick={() => setEditor({open: true, key: Date.now()})}
            >
              <Plus aria-hidden />
              {t('automations.create')}
            </Button>
          )
        }
      />

      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-hidden>
            {Array.from({length: 4}, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorView
            detail={errorMessage(q.error, t)}
            onRetry={() => void q.refetch()}
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Workflow aria-hidden />}
            title={t('automations.empty')}
            description={t('automations.emptyHint')}
            action={
              canWrite && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!online}
                  onClick={() => setEditor({open: true, key: Date.now()})}
                >
                  <Plus aria-hidden />
                  {t('automations.create')}
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t('automations.col.name')}</Th>
                  <Th>{t('automations.col.trigger')}</Th>
                  <Th>{t('automations.col.condition')}</Th>
                  <Th>{t('automations.col.effects')}</Th>
                  <Th>{t('automations.col.severity')}</Th>
                  <Th>{t('automations.col.cooldown')}</Th>
                  <Th>{t('automations.col.lastFired')}</Th>
                  <Th>{t('automations.col.enabled')}</Th>
                  {canWrite && (
                    <Th className="text-right">
                      {t('automations.col.actions')}
                    </Th>
                  )}
                </Tr>
              </THead>
              <TBody>
                {list.map(a => {
                  const name = nameOf(a);
                  const type = model.byName[triggerObjectType(a.trigger)];
                  const enabled = toggling[a.id] ?? a.enabled;
                  return (
                    <Tr key={a.id} data-testid="automation-row">
                      <Td className="font-medium text-text">{name}</Td>
                      <Td className="text-sm whitespace-nowrap text-muted">
                        {triggerSummary(a.trigger, model, t)}
                      </Td>
                      <Td className="max-w-[22rem] text-sm text-text">
                        {conditionSummary(a.condition, type, t)}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {a.effects.map((e, i) =>
                            e.kind === 'alert' ? (
                              <Badge key={i} tone="blue">
                                {t('automations.effect.alert')}
                              </Badge>
                            ) : e.kind === 'recommend' ? (
                              <Badge key={i} tone="violet">
                                <Sparkles aria-hidden />
                                {t('automations.effect.recommend')}
                                {e.perturbation &&
                                  ` · ${fmt.signedPercent(e.perturbation.change, 0)}`}
                              </Badge>
                            ) : (
                              <Badge
                                key={i}
                                tone="cyan"
                                title={t('automations.effect.action')}
                              >
                                {model.actions.find(
                                  x => x.apiName === e.actionType,
                                )?.displayName ?? e.actionType}
                              </Badge>
                            ),
                          )}
                        </div>
                      </Td>
                      <Td>
                        <SeverityBadge severity={a.severity} />
                      </Td>
                      <Td className="num text-sm whitespace-nowrap text-muted">
                        {cooldownText(a.cooldownSec, t)}
                      </Td>
                      <Td className="text-sm whitespace-nowrap text-muted">
                        {a.lastFiredAt ? (
                          <time
                            dateTime={a.lastFiredAt}
                            title={fmt.dateTime(a.lastFiredAt)}
                          >
                            {fmt.ago(a.lastFiredAt)}
                          </time>
                        ) : (
                          <span className="text-dim">
                            {t('automations.never')}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Switch
                          checked={enabled}
                          disabled={!canWrite || !online || a.id in toggling}
                          aria-label={t('automations.toggleLabel', {name})}
                          onCheckedChange={v => toggle(a, v)}
                        />
                      </Td>
                      {canWrite && (
                        <Td className="text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('automations.editLabel', {name})}
                            disabled={!online}
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
                            aria-label={t('automations.deleteLabel', {name})}
                            disabled={!online}
                            onClick={() => setDeleting(a)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </Td>
                      )}
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
            onDone={() => setEditor({open: false})}
          />
        )}
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        {deleting && (
          <DialogContent
            size="sm"
            title={t('automations.deleteTitle')}
            description={t('automations.deleteConfirm', {
              name: nameOf(deleting),
            })}
            footer={
              <>
                <Button variant="ghost" onClick={() => setDeleting(null)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="danger"
                  loading={del.isPending}
                  disabled={!online}
                  onClick={confirmDelete}
                >
                  <Trash2 aria-hidden />
                  {t('common:actions.delete')}
                </Button>
              </>
            }
          />
        )}
      </Dialog>
    </div>
  );
}
