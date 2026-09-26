/**
 * @fileoverview Ontology workbench (Modeler): type tree (left), object /
 * link / action / KPI forms (center), schema relation graph (right); draft
 * save with validation issues, unsaved-change guard, diff & publish and
 * pack export.
 */

import type {PublishReport, SchemaDef} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Link, useBlocker, useParams} from '@tanstack/react-router';
import {
  Box,
  CircleDot,
  Download,
  Gauge,
  GitCompare,
  Link2,
  Save,
  Settings2,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {useTranslation} from 'react-i18next';
import {exportPack, useSaveDraft, useSchema} from '../../features/ontology/api';
import {ActionTypeEditor} from '../../features/ontology/components/action_type_editor';
import {DiffPublishDialog} from '../../features/ontology/components/diff_publish_dialog';
import {
  KpiEditor,
  SchemaMetaEditor,
} from '../../features/ontology/components/kpi_editor';
import {LinkTypeEditor} from '../../features/ontology/components/link_type_editor';
import {ObjectTypeEditor} from '../../features/ontology/components/object_type_editor';
import {SchemaGraph} from '../../features/ontology/components/schema_graph';
import {TypeTree} from '../../features/ontology/components/type_tree';
import {ValidationIssues} from '../../features/ontology/components/validation_issues';
import {
  cleanSchema,
  downloadJson,
  emptySchema,
  initialWorkbench,
  sectionItems,
  takeNewSchema,
  workbenchReducer,
} from '../../features/ontology/model';
import type {ValidationIssue} from '@ontodecide/ontology/contract';
import {errorMessage} from '../../shared/api/error_message';
import {ApiError} from '../../shared/api/errors';
import {useOnline} from '../../shared/lib/hooks';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card, CardBody, CardHeader} from '../../shared/ui/card';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {ErrorView} from '../../shared/ui/empty_state';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {PageLoader} from '../../shared/ui/skeleton';
import {toast} from '../../shared/ui/toast';

function is404(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Ontology workbench page. */
export function OntologyWorkbenchPage() {
  const {t, i18n} = useTranslation('ontology');
  const lang = i18n.language;
  const {api = ''} = useParams({strict: false}) as {api?: string};
  const online = useOnline();
  const draftQ = useSchema(api, 'draft');
  const currentQ = useSchema(api, 'current');
  const [state, dispatch] = useReducer(workbenchReducer, api, initialWorkbench);
  const [loadSeq, setLoadSeq] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const loadedFor = useRef<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const save = useSaveDraft(api);

  // Initial load: draft → current → new empty schema.
  useEffect(() => {
    if (!api || loadedFor.current === api) return;
    const load = (
      def: SchemaDef,
      isNew: boolean,
      version?: string,
      dirty?: boolean,
    ) => {
      loadedFor.current = api;
      dispatch({type: 'load', def, isNew, version, dirty});
      setLoadSeq(s => s + 1);
    };
    if (draftQ.data)
      return load(draftQ.data.definition, false, draftQ.data.version);
    if (draftQ.isError && !is404(draftQ.error))
      return setLoadError(draftQ.error);
    if (!draftQ.isError) return;
    if (currentQ.data)
      return load(currentQ.data.definition, false, currentQ.data.version);
    if (currentQ.isError) {
      if (!is404(currentQ.error)) return setLoadError(currentQ.error);
      const stashed = takeNewSchema(api);
      return load(stashed ?? emptySchema(api), true, undefined, true);
    }
  }, [
    api,
    draftQ.data,
    draftQ.isError,
    draftQ.error,
    currentQ.data,
    currentQ.isError,
    currentQ.error,
  ]);

  const loaded = loadedFor.current === api;
  const {def, selection, dirty, isNew, version} = state;

  // Unsaved-changes guard (in-app navigation + beforeunload).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker({
    shouldBlockFn: ({current, next}) =>
      dirtyRef.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirtyRef.current,
    withResolver: true,
  });

  const doSave = useCallback(async (): Promise<boolean> => {
    const snapshot = state.def;
    try {
      const res = await save.mutateAsync(cleanSchema(snapshot));
      dispatch({type: 'saved', version: res.version, def: snapshot});
      setIssues(res.validation ?? []);
      if (res.validation?.length)
        toast.info(t('save.savedWithIssues', {count: res.validation.length}));
      else toast.success(t('save.saved'));
      return true;
    } catch (e) {
      toast.error(t('save.failed'), errorMessage(e, t));
      return false;
    }
  }, [save, state.def, t]);

  const onCompare = async () => {
    if (dirty || isNew) {
      const ok = await doSave();
      if (!ok) return;
    }
    setPublishOpen(true);
  };

  const onPublished = (r: PublishReport) => {
    dispatch({type: 'saved', version: r.version});
    setIssues([]);
    toast.success(
      t('diff.published', {version: r.version}),
      t('diff.publishedHint', {count: r.indexChanges.length}),
    );
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const pack = await exportPack(api);
      downloadJson(pack, `${api}-${pack.version}.json`);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setExporting(false);
    }
  };

  const typeNames = useMemo(
    () => def.objectTypes.map(o => o.apiName),
    [def.objectTypes],
  );
  const typeOptions = useMemo(
    () =>
      def.objectTypes.map(o => ({
        value: o.apiName,
        label: `${resolveText(o.displayName, lang, o.apiName)} (${o.apiName})`,
      })),
    [def.objectTypes, lang],
  );
  const linkNames = useMemo(
    () => def.linkTypes.map(l => l.apiName),
    [def.linkTypes],
  );

  if (loadError) {
    return (
      <div className="glass">
        <ErrorView
          detail={errorMessage(loadError, t)}
          onRetry={() => location.reload()}
        />
      </div>
    );
  }
  if (!loaded) return <PageLoader />;

  const selectedType =
    selection.kind === 'object'
      ? def.objectTypes[selection.index]?.apiName
      : undefined;
  const editorKey =
    selection.kind === 'schema'
      ? `${loadSeq}-schema`
      : `${loadSeq}-${selection.kind}-${selection.index}-${sectionItems(def, selection.kind).length}`;

  let editor: ReactNode = null;
  let editorTitle = t('tree.schemaSettings');
  let editorIcon: ReactNode = <Settings2 aria-hidden />;
  let editorApi: string | undefined;
  if (selection.kind === 'schema') {
    editor = (
      <SchemaMetaEditor
        key={editorKey}
        def={def}
        version={version}
        onChange={v =>
          dispatch({
            type: 'updateSchemaMeta',
            displayName: v.displayName,
            description: v.description,
          })
        }
      />
    );
  } else if (selection.kind === 'object' && def.objectTypes[selection.index]) {
    const o = def.objectTypes[selection.index];
    const index = selection.index;
    editorTitle = `${t('tree.objectType')} · ${resolveText(o.displayName, lang, o.apiName) || o.apiName}`;
    editorIcon = <Box aria-hidden />;
    editorApi = o.apiName;
    editor = (
      <ObjectTypeEditor
        key={editorKey}
        value={o}
        typeNames={typeNames}
        onChange={v => dispatch({type: 'updateObject', index, value: v})}
      />
    );
  } else if (selection.kind === 'link' && def.linkTypes[selection.index]) {
    const l = def.linkTypes[selection.index];
    const index = selection.index;
    editorTitle = `${t('tree.linkType')} · ${resolveText(l.displayName, lang, l.apiName) || l.apiName}`;
    editorIcon = <Link2 aria-hidden />;
    editorApi = l.apiName;
    editor = (
      <LinkTypeEditor
        key={editorKey}
        value={l}
        typeOptions={typeOptions}
        onChange={v => dispatch({type: 'updateLink', index, value: v})}
      />
    );
  } else if (selection.kind === 'action' && def.actionTypes[selection.index]) {
    const a = def.actionTypes[selection.index];
    const index = selection.index;
    editorTitle = `${t('tree.actionType')} · ${resolveText(a.displayName, lang, a.apiName) || a.apiName}`;
    editorIcon = <Zap aria-hidden />;
    editorApi = a.apiName;
    editor = (
      <ActionTypeEditor
        key={editorKey}
        value={a}
        objectTypes={def.objectTypes}
        linkNames={linkNames}
        onChange={v => dispatch({type: 'updateAction', index, value: v})}
      />
    );
  } else if (
    selection.kind === 'kpi' &&
    def.simulationKpis?.[selection.index]
  ) {
    const k = def.simulationKpis[selection.index];
    const index = selection.index;
    editorTitle = `${t('tree.kpi')} · ${resolveText(k.displayName, lang, k.apiName) || k.apiName}`;
    editorIcon = <Gauge aria-hidden />;
    editorApi = k.apiName;
    editor = (
      <KpiEditor
        key={editorKey}
        value={k}
        objectTypes={def.objectTypes}
        onChange={v => dispatch({type: 'updateKpi', index, value: v})}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        breadcrumb={
          <Link to="/ontology" className="hover:text-cyan">
            {t('index.title')}
          </Link>
        }
        title={resolveText(def.displayName, lang, def.apiName) || def.apiName}
        badges={
          <>
            <Mono>{def.apiName}</Mono>
            {version && <Badge tone="neutral">v{version}</Badge>}
            {isNew && (
              <Badge tone="violet">
                <Sparkles aria-hidden />
                {t('workbench.new')}
              </Badge>
            )}
            {dirty ? (
              <Badge tone="warn" role="status">
                <CircleDot aria-hidden />
                {t('workbench.dirty')}
              </Badge>
            ) : (
              <Badge tone="good" role="status">
                {t('workbench.clean')}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void onExport()}
              loading={exporting}
              disabled={isNew}
            >
              <Download aria-hidden />
              {t('workbench.export')}
            </Button>
            <Button
              onClick={() => void onCompare()}
              disabled={!online || save.isPending}
            >
              <GitCompare aria-hidden />
              {t('workbench.compare')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void doSave()}
              loading={save.isPending}
              disabled={!online || (!dirty && !isNew)}
            >
              <Save aria-hidden />
              {t('common:actions.saveDraft')}
            </Button>
          </>
        }
      />

      <ValidationIssues issues={issues} onDismiss={() => setIssues([])} />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[16rem_minmax(0,1fr)_24rem]">
        <Card className="h-fit p-2.5 lg:sticky lg:top-3">
          <TypeTree
            def={def}
            selection={selection}
            onSelect={s => dispatch({type: 'select', selection: s})}
            onAdd={kind => dispatch({type: 'add', kind})}
            onRemove={(kind, index) => dispatch({type: 'remove', kind, index})}
          />
        </Card>
        <Card className="min-w-0">
          <CardHeader
            title={editorTitle}
            icon={editorIcon}
            subtitle={editorApi && <Mono>{editorApi}</Mono>}
          />
          <CardBody>{editor}</CardBody>
        </Card>
        <Card className="h-fit min-w-0 lg:col-span-2 2xl:sticky 2xl:top-3 2xl:col-span-1">
          <CardHeader title={t('graph.title')} subtitle={t('graph.subtitle')} />
          <CardBody>
            <SchemaGraph
              def={def}
              selectedType={selectedType}
              onSelectType={name => {
                const index = def.objectTypes.findIndex(
                  o => o.apiName === name,
                );
                if (index >= 0)
                  dispatch({
                    type: 'select',
                    selection: {kind: 'object', index},
                  });
              }}
              height={360}
            />
          </CardBody>
        </Card>
      </div>

      <DiffPublishDialog
        apiName={api}
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onPublished={onPublished}
      />

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={o => !o && blocker.reset?.()}
      >
        <DialogContent
          size="sm"
          title={t('leave.title')}
          description={t('leave.description')}
          footer={
            <>
              <Button variant="ghost" onClick={() => blocker.reset?.()}>
                {t('leave.stay')}
              </Button>
              <Button variant="danger" onClick={() => blocker.proceed?.()}>
                {t('leave.discard')}
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
