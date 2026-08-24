/**
 * UI-layer wrapper types.
 *
 * These types are intentionally duplicated here rather than imported from
 * {@code @ontodecide/shared} per NFR-9: the shared package holds server-side
 * DTOs / domain types, while UI layout contracts stay in the frontend to
 * avoid tight coupling across service boundaries.
 */
import type { ApiError } from '@ontodecide/shared';
import type React from 'react';

/**
 * Async load state shared across page containers and data hooks.
 *
 * Pages initialize with {@code loading:true} until the backing API call
 * settles, then either {@code data} or {@code error} is populated.
 *
 * @template TData Shape of the loaded payload.
 */
export interface UiPageState<TData> {
  /** True while the initial fetch is in-flight. */
  loading: boolean;
  /** Error surface when the fetch failed; {@code undefined} otherwise. */
  error?: ApiError;
  /** Populated with the decoded payload on success. */
  data?: TData;
}

/**
 * Typed column descriptor consumed by generic table components.
 *
 * @template TRow Row model rendered by the table.
 */
export interface TableColumn<TRow> {
  /**
   * Field key. Either a property of {@code TRow} (used for default cell
   * rendering + sort keys) or an arbitrary string when the column is
   * computed purely via {@code render}.
   */
  key: keyof TRow | string;
  /** Human-readable column header. */
  header: string;
  /**
   * Optional custom cell renderer. When omitted the table renders the raw
   * {@code row[key]} value.
   */
  render?: (row: TRow) => React.ReactNode;
  /** Optional column width in pixels. */
  width?: number;
  /** If {@code true} the column header exposes a sort control. */
  sortable?: boolean;
}

/**
 * Props accepted by a generic pagination control.
 *
 * Pages are 1-based to match the API's {@code PageQuery} convention.
 */
export interface PaginationProps {
  /** Currently selected page (1-based). */
  page: number;
  /** Number of rows displayed per page. */
  size: number;
  /** Total number of rows available on the server. */
  total: number;
  /** Callback invoked when the user picks a new page or page size. */
  onChange: (page: number, size: number) => void;
}
