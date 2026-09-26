/**
 * @fileoverview Small table of a saved Object Set (first 10 objects, title
 * link plus up to three visible properties).
 */

import {Link} from '@tanstack/react-router';
import {Table2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useObjectType} from '../../../entities/schema/api';
import {orderedProperties} from '../../../entities/schema/model';
import {getRenderer} from '../../../entities/renderers/registry';
import {Panel} from '../../../shared/ui/card';
import {EmptyState, ErrorView} from '../../../shared/ui/empty_state';
import {Skeleton} from '../../../shared/ui/skeleton';
import {useSavedObjectSet} from '../../object-graph/api';

const ROWS = 10;

/** Object Set widget; renders nothing when unbound. */
export function ObjectTableWidget({
  objectSetId,
  className,
}: {
  objectSetId?: string;
  className?: string;
}) {
  const {t} = useTranslation('cockpit');
  const q = useSavedObjectSet(objectSetId);
  const items = (q.data?.items ?? []).slice(0, ROWS);
  const {type} = useObjectType(items[0]?.type);
  if (!objectSetId) return null;
  const cols = type
    ? orderedProperties(type)
        .filter(
          p =>
            p.visible &&
            p.apiName !== type.titleProperty &&
            p.apiName !== type.primaryKey,
        )
        .slice(0, 3)
    : [];
  return (
    <Panel
      title={
        type
          ? `${t('objectTable.title')} · ${type.displayName}`
          : t('objectTable.title')
      }
      icon={<Table2 aria-hidden />}
      className={className}
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({length: 4}, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorView
          title={t('objectTable.failed')}
          onRetry={() => void q.refetch()}
          className="py-6"
        />
      ) : items.length === 0 ? (
        <EmptyState title={t('objectTable.empty')} className="py-6" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-dim">
                <th className="py-1.5 pr-3 font-medium">
                  {t('objectTable.object')}
                </th>
                {cols.map(c => (
                  <th
                    key={c.apiName}
                    className="py-1.5 pr-3 font-medium whitespace-nowrap"
                  >
                    {c.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(o => (
                <tr key={o.rid} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3">
                    <Link
                      to="/objects/rid/$rid"
                      params={{rid: o.rid}}
                      className="font-medium text-text hover:text-cyan hover:underline"
                    >
                      {o.title}
                    </Link>
                  </td>
                  {cols.map(c => {
                    const r = getRenderer(c.dataType);
                    const v = o.props[c.apiName];
                    return (
                      <td
                        key={c.apiName}
                        className={
                          r.align === 'right'
                            ? 'num py-1.5 pr-3 text-right'
                            : 'py-1.5 pr-3'
                        }
                      >
                        {v === undefined || v === null ? '—' : r.cell(v, c)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
