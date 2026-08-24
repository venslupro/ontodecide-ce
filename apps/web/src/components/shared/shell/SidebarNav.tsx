/**
 * SidebarNav — left navigation tree with grouped sections.
 * Groups: Dashboard, Graph Explorer, Decisions, Data Sources, Admin.
 * Admin group hidden when isAdmin === false.
 * Sections collapsed by default on mobile (controlled via props).
 */
import { ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getSessionStub } from '@/components/shared/guards';

export interface NavItem {
  to: string;
  label: ReactNode;
  icon?: ReactNode;
  matchEnd?: boolean;
}
export interface NavGroup {
  key: string;
  title: ReactNode;
  icon?: ReactNode;
  items: NavItem[];
  hidden?: boolean;
}

export default function SidebarNav({ open, className, style, isAdmin }: {
  open?: boolean;
  className?: string;
  style?: React.CSSProperties;
  isAdmin?: boolean;
}) {
  const s = getSessionStub();
  const admin = isAdmin ?? s.role === 'admin';
  const mobileCollapsedByDefault =
    typeof window !== 'undefined' && window.matchMedia?.('(max-width:1023px)').matches
      ? true
      : false;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    dashboard: true,
    graph: !mobileCollapsedByDefault,
    decisions: !mobileCollapsedByDefault,
    ingest: !mobileCollapsedByDefault,
    admin: !mobileCollapsedByDefault,
  }));

  const groups: NavGroup[] = [
    {
      key: 'dashboard', title: 'Dashboard', icon: '🏠',
      items: [{ to: '/dashboard', label: 'Overview', matchEnd: false }],
    },
    {
      key: 'graph', title: 'Graph Explorer', icon: '🕸️',
      items: [
        { to: '/graph/ontology', label: 'Ontology Types' },
        { to: '/graph/entities', label: 'Entities' },
        { to: '/graph/explore', label: 'Graph Explore' },
      ],
    },
    {
      key: 'decisions', title: 'Decisions', icon: '🧭',
      items: [
        { to: '/decisions/scenario', label: 'Scenarios' },
        { to: '/decisions/recommend', label: 'Recommendations' },
        { to: '/decisions/agent', label: 'Decision Agent' },
      ],
    },
    {
      key: 'ingest', title: 'Data Sources', icon: '📥',
      items: [
        { to: '/ingest/sync', label: 'Sync Connectors' },
        { to: '/ingest/file', label: 'File Upload' },
      ],
    },
    {
      key: 'admin', title: 'Admin', icon: '🛡️',
      hidden: !admin,
      items: [
        { to: '/admin/users', label: 'Users' },
        { to: '/admin/audit', label: 'Audit Log' },
        { to: '/admin/config', label: 'System Config' },
        { to: '/admin/cleanup', label: 'Data Cleanup' },
      ],
    },
  ];

  const toggle = (key: string) =>
    setExpanded((e) => ({ ...e, [key]: !e[key] }));

  return (
    <nav
      aria-label="Primary navigation"
      className={className}
      style={{
        display: open === undefined ? undefined : open ? 'flex' : 'none',
        flexDirection: 'column', gap: 4,
        padding: 'var(--space-3)',
        overflowY: 'auto',
        ...style,
      }}
    >
      {groups.filter((g) => !g.hidden).map((g) => (
        <div key={g.key}>
          <button
            type="button"
            aria-expanded={!!expanded[g.key]}
            onClick={() => toggle(g.key)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px', borderRadius: 'var(--radius-md)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              color: 'var(--color-neutral-500)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              textAlign: 'left',
            }}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span aria-hidden="true" style={{ fontSize: 14 }}>{g.icon ?? '📁'}</span>
              {g.title}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"
              style={{
                transform: expanded[g.key] ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform .15s ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </button>
          {expanded[g.key] ? (
            <ul style={{
              listStyle: 'none', margin: 0, padding: '2px 0 8px 0',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              {g.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.matchEnd}
                    style={({ isActive }) => ({
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px 8px 32px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 14,
                      color: isActive ? 'var(--color-primary)' : 'var(--color-neutral-700)',
                      background: isActive ? 'var(--color-primary-50)' : 'transparent',
                      fontWeight: isActive ? 600 : 500,
                      textDecoration: 'none',
                      border: isActive ? '1px solid #D4C7FC' : '1px solid transparent',
                    })}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
