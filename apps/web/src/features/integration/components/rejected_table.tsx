/**
 * @fileoverview Rejected rows of an import job (row / column / code /
 * detail — never cell values) and the localized reject reason.
 */

import type {RejectDto} from '@ontodecide/integration/contract';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../../shared/ui/badge';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';

/** Localized label of a reject code (unknown codes shown verbatim). */
export function useRejectReason(): (code: string) => string {
  const {t} = useTranslation('imports');
  return code =>
    t(`codes.${code}`, {defaultValue: ''}) || t('codes.unknown', {code});
}

/** Rejects table. */
export function RejectedTable({rejects}: {rejects: readonly RejectDto[]}) {
  const {t} = useTranslation('imports');
  const reason = useRejectReason();
  return (
    <div className="max-h-[28rem] overflow-auto">
      <Table aria-label={t('job.rejects')}>
        <THead>
          <Tr>
            <Th>{t('job.col.row')}</Th>
            <Th>{t('job.col.column')}</Th>
            <Th>{t('job.col.code')}</Th>
            <Th>{t('job.col.detail')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rejects.map((r, i) => (
            <Tr key={`${r.row}:${i}`}>
              <Td className="num text-xs">{r.row}</Td>
              <Td className="font-mono text-xs">{r.column ?? '—'}</Td>
              <Td>
                <Badge tone="crit" title={r.code}>
                  {reason(r.code)}
                </Badge>
              </Td>
              <Td className="text-xs text-muted">{r.detail ?? ''}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
