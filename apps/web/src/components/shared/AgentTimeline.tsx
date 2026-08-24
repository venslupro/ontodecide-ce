/**
 * AgentTimeline — vertical task timeline for decision agent traces.
 * Each task shows: status dot (colored), label, start/end, result.
 */
import { HTMLAttributes, ReactNode } from 'react';

export type AgentTaskStatus =
  | 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface AgentTask {
  label: ReactNode;
  status: AgentTaskStatus;
  start?: ReactNode;
  end?: ReactNode;
  result?: ReactNode;
  ariaLabel?: string;
}
export interface AgentTimelineProps extends HTMLAttributes<HTMLDivElement> {
  tasks: AgentTask[];
}

const statusColor: Record<AgentTaskStatus, string> = {
  pending: 'var(--color-neutral-300)',
  running: 'var(--color-primary)',
  success: 'var(--color-success)',
  failed:  'var(--color-danger)',
  skipped: 'var(--color-neutral-500)',
};

export default function AgentTimeline({
  tasks, className = '', style, ...rest
}: AgentTimelineProps) {
  return (
    <div
      className={className}
      style={{
        background: '#fff', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-3)', ...style,
      }}
      {...rest}
    >
      <ol
        role="list"
        aria-label="Decision agent task timeline"
        style={{
          position: 'relative', margin: 0, padding: 0,
          listStyle: 'none', display: 'flex', flexDirection: 'column',
        }}
      >
        {tasks.map((t, i) => {
          const color = statusColor[t.status];
          const last = i === tasks.length - 1;
          return (
            <li
              key={i}
              aria-label={t.ariaLabel ?? `Task ${i + 1} — status ${t.status}`}
              style={{
                position: 'relative', paddingLeft: 28,
                paddingTop: i === 0 ? 0 : 12,
                paddingBottom: last ? 0 : 12,
              }}
            >
              {!last ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: 7, top: 16, bottom: -4,
                    width: 2, background: 'var(--color-neutral-200)',
                  }}
                />
              ) : null}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', left: 0, top: i === 0 ? 0 : 12,
                  width: 16, height: 16, borderRadius: '50%',
                  background: color, border: '3px solid #fff',
                  boxShadow: '0 0 0 1px var(--color-neutral-200)',
                }}
              />
              <div style={{
                display: 'flex', alignItems: 'baseline',
                justifyContent: 'space-between', gap: 8,
                flexWrap: 'wrap',
              }}>
                <strong style={{
                  fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-900)',
                }}>
                  {t.label}
                </strong>
                <span style={{
                  fontSize: 12, color: 'var(--color-neutral-500)',
                  display: 'inline-flex', gap: 10, flexWrap: 'wrap',
                }}>
                  {t.start ? <span>Start: {t.start}</span> : null}
                  {t.end ? <span>End: {t.end}</span> : null}
                </span>
              </div>
              {t.result ? (
                <div style={{
                  marginTop: 4, fontSize: 13, color: 'var(--color-neutral-700)',
                }}>
                  {t.result}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
