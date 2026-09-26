/**
 * @fileoverview Compact preview table of parsed source rows.
 */

import {useTranslation} from 'react-i18next';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Shows up to `max` rows of `fields`. */
export function SampleTable({
  fields,
  rows,
  max = 8,
  caption,
}: {
  fields: readonly string[];
  rows: readonly Record<string, unknown>[];
  max?: number;
  caption?: string;
}) {
  const {t} = useTranslation('sources');
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      <Table aria-label={caption ?? t('upload.sample')}>
        <THead>
          <tr>
            <Th className="w-10 text-right">#</Th>
            {fields.map(f => (
              <Th key={f} className="font-mono">
                {f}
              </Th>
            ))}
          </tr>
        </THead>
        <TBody>
          {rows.slice(0, max).map((r, i) => (
            <Tr key={i}>
              <Td className="num text-right text-xs text-dim">{i + 1}</Td>
              {fields.map(f => (
                <Td
                  key={f}
                  className="max-w-56 truncate text-xs whitespace-nowrap"
                  title={cell(r[f])}
                >
                  {cell(r[f]) || <span className="text-dim">—</span>}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
