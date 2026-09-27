/**
 * @fileoverview Compact table of parsed sample rows (values shown as-is:
 * business data is never translated).
 */

import type {SourceRow} from '../../../workers/parse_core';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';

/** Renders a cell value as text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Sample rows table. */
export function SampleTable({
  fields,
  rows,
  caption,
}: {
  fields: readonly string[];
  rows: readonly SourceRow[];
  caption: string;
}) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      <Table aria-label={caption}>
        <THead>
          <Tr>
            <Th className="w-10 text-right">#</Th>
            {fields.map(f => (
              <Th key={f} className="font-mono">
                {f}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <Tr key={i}>
              <Td className="num text-right text-xs text-dim">{i + 1}</Td>
              {fields.map(f => (
                <Td
                  key={f}
                  className="max-w-56 truncate text-xs"
                  title={cellText(r[f])}
                >
                  {cellText(r[f])}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
