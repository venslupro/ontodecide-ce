/**
 * @fileoverview 本体工作台 (/ontology): left the definition tree (object
 * types with property counts, link types, action types), middle the form of
 * the selected definition validated with the contract `defSchemas`, right
 * the schema graph. CE has a single ontology version: saving takes effect
 * immediately (If-Match = schema etag). While the workspace still
 * references the shared template, a notice says the first change copies it.
 */

import type {OntologyDto, TypeDef} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {Copy, Network, RotateCcw, Save, Trash2} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  fetchOntology,
  ontologyKey,
  useOntology,
} from '../../entities/schema/api';
import {ConflictDialog} from '../../features/object-graph/components/conflict_dialog';
import {
  useDeleteDefinition,
  useSaveDefinition,
} from '../../features/ontology/api';
import {ActionTypeFormView} from '../../features/ontology/components/action_type_form';
import {DeleteDefinitionDialog} from '../../features/ontology/components/delete_definition_dialog';
import {useIssueText} from '../../features/ontology/components/form_bits';
import {LinkTypeFormView} from '../../features/ontology/components/link_type_form';
import {ObjectTypeFormView} from '../../features/ontology/components/object_type_form';
import {SchemaGraph} from '../../features/ontology/components/schema_graph';
import {
  type DefSelection,
  TypeTree,
} from '../../features/ontology/components/type_tree';
import {
  buildDef,
  type DefForm,
  defsOf,
  defToForm,
  type FieldIssue,
  formToDef,
  issuesByPath,
  newForm,
  serverIssues,
  withDefinition,
} from '../../features/ontology/model';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card, Panel} from '../../shared/ui/card';
import {ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {toast} from '../../shared/ui/toast';

function findDef(o: OntologyDto, sel: DefSelection): TypeDef | undefined {
  return sel.id === null
    ? undefined
    : defsOf(o.definition, sel.kind).find(d => d.apiName === sel.id);
}

function formFor(o: OntologyDto, sel: DefSelection): DefForm | null {
  if (sel.id === null)
    return newForm(
      sel.kind,
      o.definition.objectTypes.map(t => t.apiName),
    );
  const def = findDef(o, sel);
  return def ? defToForm(sel.kind, def) : null;
}

function firstSelection(o: OntologyDto): DefSelection | null {
  const first = o.definition.objectTypes[0];
  return first ? {kind: 'object-types', id: first.apiName} : null;
}

/** Ontology workbench page. */
export function OntologyPage() {
  const {t, i18n} = useTranslation('ontology');
  const locale = i18n.language;
  const qc = useQueryClient();
  const q = useOntology();
  const save = useSaveDefinition();
  const del = useDeleteDefinition();
  const issueText = useIssueText();
  const [sel, setSel] = useState<DefSelection | null>(null);
  const [form, setForm] = useState<DefForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<{
    sel: DefSelection;
    mine?: Record<string, unknown>;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const o = q.data;

  // Default selection: the first object type.
  useEffect(() => {
    if (o && !sel) setSel(firstSelection(o));
  }, [o, sel]);

  // (Re)load the form from the server state unless the user has edits.
  useEffect(() => {
    if (!o || !sel || dirty) return;
    const next = formFor(o, sel);
    if (next) setForm(next);
    else if (sel.id !== null) setSel(firstSelection(o));
    // `dirty` intentionally omitted: clearing it must not discard the
    // freshly saved form before the cache update lands.
  }, [o, sel]);

  const byPath = useMemo(() => issuesByPath(issues), [issues]);

  const select = (next: DefSelection) => {
    setSel(next);
    setDirty(false);
    setIssues([]);
    setSaveError(null);
    save.reset();
    if (o) setForm(formFor(o, next));
  };

  const edit = (next: DefForm) => {
    setForm(next);
    setDirty(true);
  };

  const discard = () => {
    if (o && sel) setForm(formFor(o, sel));
    setDirty(false);
    setIssues([]);
    setSaveError(null);
  };

  const onSave = () => {
    if (!o || !sel || !form) return;
    setSaveError(null);
    const r = buildDef(form, {def: o.definition, isNew: sel.id === null});
    setIssues(r.issues);
    if (!r.def) return;
    const def = r.def;
    const kind = sel.kind;
    save.mutate(
      {kind, def, etag: o.etag, id: sel.id ?? undefined},
      {
        onSuccess: etag => {
          qc.setQueryData<OntologyDto>(ontologyKey(), cur =>
            cur
              ? withDefinition(cur, kind, sel.id ?? def.apiName, def, etag)
              : cur,
          );
          setDirty(false);
          setSel({kind, id: def.apiName});
          setForm(defToForm(kind, def));
          toast.success(
            t('saved', {
              name: resolveText(def.displayName, locale, def.apiName),
            }),
          );
        },
        onError: e => {
          if (isApiError(e, 'PRECONDITION_FAILED') && e.status === 412) {
            setConflict({sel, mine: def as unknown as Record<string, unknown>});
            return;
          }
          const si = serverIssues(e);
          if (si.length) setIssues(si);
          else setSaveError(e);
        },
      },
    );
  };

  const onDelete = () => {
    if (!o || !sel?.id) return;
    const {kind, id} = sel;
    del.mutate(
      {kind, id, etag: o.etag},
      {
        onSuccess: etag => {
          const next = withDefinition(o, kind, id, null, etag);
          qc.setQueryData<OntologyDto>(ontologyKey(), next);
          setDeleting(false);
          toast.success(t('deleted', {name: id}));
          select(firstSelection(next) ?? {kind: 'object-types', id: null});
        },
        onError: e => {
          if (isApiError(e, 'PRECONDITION_FAILED') && e.status === 412) {
            setDeleting(false);
            setConflict({sel: {kind, id}});
          }
        },
      },
    );
  };

  const refreshAfterConflict = () => {
    setDirty(false);
    setIssues([]);
    void q.refetch().then(r => {
      if (r.data && sel) setForm(formFor(r.data, sel));
    });
  };

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }
  if (q.isError || !o) {
    return (
      <ErrorView
        traceId={errorTraceId(q.error)}
        detail={errorMessage(q.error, t)}
        onRetry={() => void q.refetch()}
      />
    );
  }

  const current = sel ? findDef(o, sel) : undefined;
  const title = sel
    ? current
      ? resolveText(current.displayName, locale, current.apiName)
      : t(`tree.new.${sel.kind}`)
    : '';
  const general = [...byPath.values()].filter(
    i => i.path === '' || i.code === 'server',
  );
  const templateName = t(`template.${o.templateId}`, {
    defaultValue: o.templateId,
  });
  const typeNames = o.definition.objectTypes.map(x => x.apiName);
  const typeOptions = o.definition.objectTypes.map(x => ({
    value: x.apiName,
    label: resolveText(x.displayName, locale, x.apiName),
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        badges={
          o.custom ? (
            <Badge tone="good">{t('badge.custom', {etag: o.etag})}</Badge>
          ) : (
            <Badge tone="cyan">
              {t('badge.template', {name: templateName})}
            </Badge>
          )
        }
      />

      {!o.custom && o.templateId !== 'blank' && (
        <div
          role="note"
          data-testid="copy-on-write-notice"
          className="glass flex items-start gap-2.5 border-cyan/30 px-4 py-3 text-sm"
        >
          <Copy className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
          <div>
            <p className="font-medium text-text">{t('notice.copyOnWrite')}</p>
            <p className="mt-0.5 text-xs text-muted">
              {t('notice.detail', {name: templateName})}
            </p>
          </div>
        </div>
      )}

      {!o.custom && o.templateId === 'blank' && (
        <div
          role="note"
          className="glass flex items-start gap-2.5 border-cyan/30 px-4 py-3 text-sm"
        >
          <Copy className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
          <div>
            <p className="font-medium text-text">{t('blankNotice')}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_minmax(300px,380px)]">
        <Card className="self-start p-3">
          <TypeTree
            ontology={o.definition}
            locale={locale}
            selected={sel}
            onSelect={select}
          />
        </Card>

        <Panel
          title={
            <span className="flex items-center gap-2">
              {title}
              {sel && <Badge tone="neutral">{t(`kindOne.${sel.kind}`)}</Badge>}
              {dirty && <Badge tone="warn">{t('unsaved')}</Badge>}
            </span>
          }
          actions={
            sel && (
              <>
                {dirty && (
                  <Button size="sm" variant="ghost" onClick={discard}>
                    <RotateCcw aria-hidden />
                    {t('actions.discard')}
                  </Button>
                )}
                {sel.id !== null && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      del.reset();
                      setDeleting(true);
                    }}
                  >
                    <Trash2 aria-hidden />
                    {t('actions.delete')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  loading={save.isPending}
                  disabled={!dirty && sel.id !== null}
                  onClick={onSave}
                >
                  <Save aria-hidden />
                  {t('actions.save')}
                </Button>
              </>
            )
          }
        >
          {general.length > 0 && (
            <ul
              role="alert"
              className="mb-3 rounded-[10px] border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit"
            >
              {general.map(i => (
                <li key={`${i.path}:${i.message ?? i.code}`}>
                  {i.path && <span className="font-mono">{i.path}: </span>}
                  {issueText(i)}
                </li>
              ))}
            </ul>
          )}
          {saveError ? (
            <p role="alert" className="mb-3 text-sm text-crit">
              {errorMessage(saveError, t)}
            </p>
          ) : null}
          {!form || !sel ? (
            <p className="text-sm text-dim">{t('empty')}</p>
          ) : form.kind === 'object-types' ? (
            <ObjectTypeFormView
              form={form}
              onChange={edit}
              issues={byPath}
              isNew={sel.id === null}
              typeNames={typeNames}
            />
          ) : form.kind === 'link-types' ? (
            <LinkTypeFormView
              form={form}
              onChange={edit}
              issues={byPath}
              isNew={sel.id === null}
              typeOptions={typeOptions}
            />
          ) : (
            <ActionTypeFormView
              form={form}
              onChange={edit}
              issues={byPath}
              isNew={sel.id === null}
              ontology={o.definition}
              locale={locale}
            />
          )}
        </Panel>

        <Panel
          title={t('graph.title')}
          subtitle={t('graph.subtitle', {
            types: o.definition.objectTypes.length,
            links: o.definition.linkTypes.length,
          })}
          icon={<Network aria-hidden />}
          className="self-start"
        >
          <SchemaGraph
            ontology={o.definition}
            locale={locale}
            selectedType={
              sel?.kind === 'object-types' ? (sel.id ?? undefined) : undefined
            }
            onSelectType={id => select({kind: 'object-types', id})}
          />
        </Panel>
      </div>

      {sel?.id && (
        <DeleteDefinitionDialog
          open={deleting}
          onOpenChange={setDeleting}
          kind={sel.kind}
          id={sel.id}
          label={title}
          ontology={o.definition}
          pending={del.isPending}
          error={del.error}
          onConfirm={onDelete}
        />
      )}

      <ConflictDialog
        open={!!conflict}
        onOpenChange={v => !v && setConflict(null)}
        onRefresh={refreshAfterConflict}
        mine={
          conflict?.mine ??
          (form
            ? (formToDef(form).def as unknown as Record<string, unknown>)
            : undefined)
        }
        loadTheirs={async () => {
          if (!conflict) return undefined;
          const fresh = await fetchOntology();
          return findDef(fresh, conflict.sel) as unknown as
            Record<string, unknown> | undefined;
        }}
      />
    </div>
  );
}
