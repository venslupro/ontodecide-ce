/**
 * UserMenu — right-end of AppBar. Avatar initials, dropdown with username,
 * role badge, change password link, logout button.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import RoleBadge from '@/components/shared/RoleBadge';
import { getSessionStub } from '@/components/shared/guards';

export default function UserMenu({ className, style }: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const s = getSessionStub();
  const username = s.username ?? 'user';
  const role = s.role ?? 'viewer';
  const initials = username
    .split(/[^A-Za-z0-9]+/)
    .map((x: string) => x.charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join('') || 'U';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className={className} style={{ position: 'relative', ...style }}>
      <style>{`
        .usermenu-username-inline{display:none}
        @media(min-width:768px){.usermenu-username-inline{display:inline-flex}}
      `}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`User menu for ${username}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '4px 8px 4px 4px', borderRadius: 999,
          background: 'transparent', border: '1px solid transparent',
          cursor: 'pointer', transition: 'all .15s ease',
        }}
      >
        <span
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--color-primary)', color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13,
          }}
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="usermenu-username-inline">
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14, color: 'var(--color-neutral-900)', fontWeight: 500 }}>
              {username}
            </span>
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" fill="none"
            stroke="var(--color-neutral-500)" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="User menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)',
            minWidth: 220, background: '#fff',
            border: '1px solid var(--color-neutral-200)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)', padding: 8, zIndex: 50,
          }}
        >
          <div style={{
            padding: '8px 10px', borderBottom: '1px solid var(--color-neutral-100)',
            marginBottom: 4,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
              {username}
            </div>
            <div style={{ marginTop: 4 }}>
              <RoleBadge role={role as any} />
            </div>
          </div>
          <Link
            to="/auth/change-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{
              display: 'block', padding: '8px 10px', fontSize: 14,
              color: 'var(--color-neutral-700)', borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
            }}
          >
            Change password
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (typeof window !== 'undefined') window.location.hash = '#/login';
            }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', fontSize: 14,
              color: 'var(--color-danger)',
              background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
