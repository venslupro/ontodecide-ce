/**
 * @fileoverview Ontology index (Modeler): schema list (version, draft flag,
 * object type count, published time), ontology packs with import (built-in
 * supply-chain pack highlighted, JSON file import) and "new ontology".
 */

import {resolveText} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {ChevronRight, FilePen, Network} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useHasRole} from '../../entities/session/store';
import {useSchemas} from '../../features/ontology/api';
import {NewSchemaDialog} from '../../features/ontology/components/new_schema_dialog';
import {PackImportPanel} from '../../features/ontology/components/pack_import';
import {errorMessage} from '../../shared/api/error_message';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {Badge} from '../../shared/ui/badge';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';

/** Ontology index page. */
export function OntologyIndexPage() {
  const {t, i18n} = useTranslation('ontology');
  const canWrite = useHasRole('Modeler');
  const online = useOnline();
  const schemas = useSchemas();
  const list = schemas.data ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        title={t('index.title')}
        description={t('index.description')}
        actions={
          canWrite && (
            <NewSchemaDialog
              existing={list.map(s => s.apiName)}
              disabled={!online}
            />
          )
        }
      />
      <div className="grid grid-cols-12 gap-3.5">
        <Panel
          className="col-span-12 xl:col-span-7"
          title={t('index.schemas')}
          subtitle={t('index.schemasSubtitle')}
          icon={<Network aria-hidden />}
          bodyClassName="px-0"
        >
          {schemas.isLoading && (
            <div className="flex flex-col gap-2 px-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          )}
          {schemas.isError && (
            <ErrorView
              detail={errorMessage(schemas.error, t)}
              onRetry={() => void schemas.refetch()}
            />
          )}
          {schemas.data && list.length === 0 && (
            <EmptyState
              title={t('index.noSchemas')}
              description={t('index.noSchemasHint')}
            />
          )}
          {list.length > 0 && (
            <Table aria-label={t('index.schemas')}>
              <THead>
                <tr className="border-b border-line">
                  <Th className="pl-4">{t('index.col.name')}</Th>
                  <Th>{t('index.col.version')}</Th>
                  <Th className="text-right">{t('index.col.objectTypes')}</Th>
                  <Th>{t('index.col.publishedAt')}</Th>
                  <Th className="pr-4">
                    <span className="sr-only">{t('fields.actions')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {list.map(s => (
                  <Tr key={s.apiName}>
                    <Td className="pl-4">
                      <Link
                        to="/ontology/$api"
                        params={{api: s.apiName}}
                        className="font-medium text-text hover:text-cyan"
                      >
                        {resolveText(s.displayName, i18n.language, s.apiName)}
                      </Link>
                      <div>
                        <Mono>{s.apiName}</Mono>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.currentVersion ? (
                          <Mono className="text-text">v{s.currentVersion}</Mono>
                        ) : (
                          <span className="text-xs text-dim">
                            {t('schema.unpublished')}
                          </span>
                        )}
                        {s.hasDraft && (
                          <Badge tone="violet">
                            <FilePen aria-hidden />
                            {t('index.draft')}
                          </Badge>
                        )}
                      </div>
                    </Td>
                    <Td className="num text-right">{s.objectTypeCount}</Td>
                    <Td className="whitespace-nowrap text-muted">
                      {s.publishedAt ? fmt.dateTime(s.publishedAt) : '—'}
                    </Td>
                    <Td className="pr-4 text-right">
                      <Link
                        to="/ontology/$api"
                        params={{api: s.apiName}}
                        className="inline-flex items-center gap-0.5 text-sm whitespace-nowrap text-cyan hover:underline"
                        aria-label={t('index.openAria', {
                          name: resolveText(
                            s.displayName,
                            i18n.language,
                            s.apiName,
                          ),
                        })}
                      >
                        {t('index.open')}
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
        <div className="col-span-12 xl:col-span-5">
          <PackImportPanel canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}
