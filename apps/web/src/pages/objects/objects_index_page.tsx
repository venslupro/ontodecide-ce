/**
 * @fileoverview Object browser index (/objects): one card per object type of
 * the published ontology with property / link / action counts, linking to
 * the ontology-driven object table.
 */

import {Link} from '@tanstack/react-router';
import {ArrowRight, Boxes, Link2, ListTree, Lock, Zap} from 'lucide-react';
import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {useHasRole} from '../../entities/session/store';
import {TypeIcon} from '../../features/object-graph/components/type_icon';
import {errorMessage} from '../../shared/api/error_message';
import {track} from '../../shared/lib/telemetry';
import {Button} from '../../shared/ui/button';
import {Card} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';

/** /objects — object types of the active ontology. */
export function ObjectsIndexPage() {
  const {t} = useTranslation('objects');
  const {model, isLoading, error} = useUiModel();
  const isModeler = useHasRole('Modeler');

  useEffect(() => track('page_view:objects'), []);

  return (
    <div className="fade-in">
      <PageHeader
        title={t('index.title')}
        description={t('index.description')}
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({length: 3}, (_, i) => (
            <Card key={i} className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <ErrorView detail={errorMessage(error, t)} />
        </Card>
      ) : model.types.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes aria-hidden />}
            title={t('index.emptyTitle')}
            description={
              isModeler ? t('index.emptyModeler') : t('index.emptyViewer')
            }
            action={
              isModeler ? (
                <Button asChild variant="primary">
                  <Link to="/ontology">{t('index.goOntology')}</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3"
          aria-label={t('index.title')}
        >
          {model.types.map(ty => {
            const hidden = ty.properties.filter(p => !p.visible).length;
            return (
              <li key={ty.apiName}>
                <Link
                  to="/objects/$type"
                  params={{type: ty.apiName}}
                  className="glass group flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-[0_0_0_1px_var(--cyan)] focus-visible:shadow-[0_0_0_1px_var(--cyan)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan/30 bg-cyan/10 text-cyan">
                        <TypeIcon icon={ty.icon} className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-text">
                          {ty.displayName}
                        </h2>
                        <Mono className="text-[11px] text-dim">
                          {ty.apiName}
                        </Mono>
                      </div>
                    </div>
                    <ArrowRight
                      className="size-4 shrink-0 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-cyan"
                      aria-hidden
                    />
                  </div>
                  <p className="line-clamp-2 min-h-[2.5em] text-sm text-muted">
                    {ty.description ?? t('index.noDescription')}
                  </p>
                  <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <Stat
                      icon={<ListTree aria-hidden />}
                      label={t('index.properties')}
                      value={ty.properties.length}
                    />
                    <Stat
                      icon={<Link2 aria-hidden />}
                      label={t('index.links')}
                      value={ty.links.length}
                    />
                    <Stat
                      icon={<Zap aria-hidden />}
                      label={t('index.actions')}
                      value={ty.actions.length}
                    />
                    {hidden > 0 && (
                      <Stat
                        icon={<Lock aria-hidden />}
                        label={t('index.hidden')}
                        value={hidden}
                      />
                    )}
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5 [&_svg]:text-dim">
      {icon}
      <dt>{label}</dt>
      <dd className="num font-medium text-text">{value}</dd>
    </div>
  );
}
