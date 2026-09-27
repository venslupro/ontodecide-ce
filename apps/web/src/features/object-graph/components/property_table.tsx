/**
 * @fileoverview Object View property table: values in ontology order via
 * the renderer registry, each with its source (「文件导入 <job> 第 n 行」) and
 * update time; hovering / focusing a row shows the full lineage. Inline
 * edit sends an RFC 7396 merge patch with If-Match (412 → conflict dialog).
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {AlertTriangle, Pencil} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {getRenderer} from '../../../entities/renderers/registry';
import {
  orderedProperties,
  type UiObjectType,
  type UiProperty,
} from '../../../entities/schema/model';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {toast} from '../../../shared/ui/toast';
import {useImportJob} from '../../integration/api';
import {usePatchObject} from '../api';
import {buildMergePatch, provenanceOf} from '../model';

function Lineage({obj, prop}: {obj: ObjectDto; prop: UiProperty}) {
  const {t} = useTranslation('objects');
  const p = provenanceOf(obj, prop.apiName);
  const job = useImportJob(p?.jobId);
  return (
    <div
      className="mt-3 rounded-[10px] border border-cyan/30 bg-cyan/5 px-3 py-2.5 text-xs"
      aria-live="polite"
    >
      <p className="font-medium text-text">
        {t('props.lineageTitle', {prop: prop.apiName})}
      </p>
      <p className="mt-1 text-muted">
        {p
          ? t('props.lineage', {
              job: p.jobId,
              file: job.data?.fileName ?? '—',
              row: p.row,
              time: fmt.dateTime(p.at),
            })
          : t('props.noLineage')}
      </p>
    </div>
  );
}

/** Property table props. */
export interface PropertyTableProps {
  type: UiObjectType;
  object: ObjectDto;
  /** Called on 412 with the local edits. */
  onConflict(mine: Record<string, unknown>): void;
  /** Property to highlight first (e.g. `?prop=` from an evidence link). */
  focusProp?: string;
}

/** The table. */
export function PropertyTable({
  type,
  object,
  onConflict,
  focusProp,
}: PropertyTableProps) {
  const {t} = useTranslation('objects');
  const props = orderedProperties(type);
  const [focus, setFocus] = useState<string>(
    () =>
      (focusProp && props.some(p => p.apiName === focusProp)
        ? focusProp
        : undefined) ??
      props.find(p => provenanceOf(object, p.apiName))?.apiName ??
      props[0]?.apiName,
  );
  const [editing, setEditing] = useState(false);
  const patch = usePatchObject(object.rid);
  const form = useForm<Record<string, unknown>>({defaultValues: object.props});
  useEffect(() => {
    if (!editing) form.reset(object.props);
  }, [object.props, editing, form]);
  const focused = props.find(p => p.apiName === focus);
  const invalid = new Set(object.invalidProps ?? []);

  const save = form.handleSubmit(values => {
    const body = buildMergePatch(object.props, values);
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    patch.mutate(
      {patch: body, version: object.version},
      {
        onSuccess: () => {
          toast.success(t('props.saved'));
          setEditing(false);
        },
        onError: e => {
          if (isApiError(e, 'PRECONDITION_FAILED')) onConflict(values);
        },
      },
    );
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('props.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={patch.isPending}
              onClick={() => void save()}
            >
              {t('props.save')}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t('props.edit')}
          </Button>
        )}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="h-8 px-2 font-medium">{t('props.property')}</th>
            <th className="h-8 px-2 font-medium">{t('props.value')}</th>
            <th className="h-8 px-2 font-medium">{t('props.source')}</th>
            <th className="h-8 px-2 font-medium">{t('props.updated')}</th>
          </tr>
        </thead>
        <tbody>
          {props.map(p => {
            const prov = provenanceOf(object, p.apiName);
            const v = object.props[p.apiName];
            const id = `prop-${p.apiName}`;
            const editable = editing && p.apiName !== type.primaryKey;
            return (
              <tr
                key={p.apiName}
                onMouseEnter={() => setFocus(p.apiName)}
                onFocus={() => setFocus(p.apiName)}
                tabIndex={editing ? undefined : 0}
                className={cn(
                  'border-b border-line align-middle',
                  focus === p.apiName && 'bg-panel-2/60',
                )}
              >
                <td className="px-2 py-2 font-mono text-xs text-muted">
                  <label
                    htmlFor={editable ? id : undefined}
                    title={p.displayName}
                  >
                    {p.apiName}
                  </label>
                </td>
                <td className="px-2 py-1.5">
                  {editable ? (
                    <Controller
                      control={form.control}
                      name={p.apiName}
                      render={({field}) =>
                        getRenderer(p.dataType).input(p, field, {
                          id,
                        }) as React.ReactElement
                      }
                    />
                  ) : v === undefined || v === null ? (
                    <span className="text-dim">{t('props.notImported')}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {getRenderer(p.dataType).cell(v, p)}
                      {invalid.has(p.apiName) && (
                        <Badge tone="warn" title={t('props.invalidHint')}>
                          <AlertTriangle aria-hidden />
                          {t('props.invalid')}
                        </Badge>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {prov ? (
                    <Badge tone="blue">
                      {t('props.fromImport', {job: prov.jobId})}
                    </Badge>
                  ) : (
                    <Badge>{t('props.manual')}</Badge>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs whitespace-nowrap text-muted">
                  {prov ? fmt.ago(prov.at) : fmt.ago(object.updatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {patch.error && !isApiError(patch.error, 'PRECONDITION_FAILED') && (
        <p role="alert" className="mt-2 text-xs text-crit">
          {errorMessage(patch.error, t)}
        </p>
      )}
      {focused && !editing && <Lineage obj={object} prop={focused} />}
    </div>
  );
}
