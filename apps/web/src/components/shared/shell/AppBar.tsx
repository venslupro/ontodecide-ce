/**
 * AppBar — top bar. 64px tall, white bg, border bottom neutral-200, shadow-sm.
 * Left: external logo image + brand "OntoDecide".  Right: Breadcrumbs + UserMenu.
 * Includes a hamburger button for mobile sidebar toggles.
 */
import IconButton from '@/components/ui/IconButton';
import BreadcrumbsShell from './Breadcrumbs';
import UserMenu from './UserMenu';
import Logo from '@/components/shared/Logo';

export default function AppBar({ onToggleSidebar, className, style }: {
  onToggleSidebar?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <header
      className={className}
      style={{
        position: 'sticky', top: 0, zIndex: 20,
        height: 64,
        display: 'flex', alignItems: 'center',
        padding: '0 var(--space-3)',
        background: '#fff',
        borderBottom: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)',
        gap: 'var(--space-2)',
        ...style,
      }}
    >
      <style>{`
        .appbar-hamburger-wrap{display:inline-flex;align-items:center}
        @media(min-width:1024px){
          .appbar-hamburger-wrap{display:none!important}
        }
        .appbar-desktop-breadcrumbs{display:none}
        @media(min-width:768px){
          .appbar-desktop-breadcrumbs{display:flex;
            align-items:center;flex:1;justify-content:flex-start}
        }
      `}</style>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
      }}>
        <span className="appbar-hamburger-wrap">
          <IconButton
            aria-label="Toggle navigation sidebar"
            size="md"
            variant="ghost"
            onClick={onToggleSidebar}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18M3 12h18M3 18h18"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </IconButton>
        </span>
        <MobileHamburger onToggleSidebar={onToggleSidebar} />
        <Logo size={30} color="var(--color-neutral-900)" />
      </div>
      <div style={{
        flex: 1, minWidth: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 'var(--space-2)',
      }}>
        <div className="appbar-desktop-breadcrumbs">
          <DesktopBreadcrumbs />
        </div>
        <UserMenu />
      </div>
    </header>
  );
}

function DesktopBreadcrumbs() {
  return (
    <div>
      <BreadcrumbsShell />
    </div>
  );
}

function MobileHamburger({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  if (typeof window === 'undefined') return null;
  return (
    <span style={{ display: 'inline-flex' }}>
      <style>{`
        .appbar-hamburger{display:inline-flex}
        @media(min-width:1024px){.appbar-hamburger{display:none!important}}
      `}</style>
      <button
        type="button"
        aria-label="Toggle navigation sidebar"
        onClick={onToggleSidebar}
        className="appbar-hamburger"
        style={{
          width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-md)', background: 'transparent',
          border: '1px solid transparent', color: 'var(--color-neutral-700)',
          cursor: 'pointer', padding: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
        </svg>
      </button>
    </span>
  );
}
