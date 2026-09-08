/**
 * AppShell — main layout. Desktop: 260px sidebar + main.
 * Main has max-width 1440px centered + padding space-6.
 * Mobile (<1024px): sidebar collapses to a drawer overlay.
 */
import { ReactNode, useEffect, useState } from 'react';
import AppBar from './AppBar';
import SidebarNav from './SidebarNav';
import BreadcrumbsShell from './Breadcrumbs';

export default function AppShell({ children, className, style }: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width:1023px)');
    const onChange = () => {
      setIsMobile(query.matches);
      setSidebarOpen(!query.matches);
    };
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const toggle = () => setSidebarOpen((o) => !o);

  return (
    <div
      className={className}
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: isMobile ? '0 1fr' : '260px 1fr',
        gridTemplateRows: '64px 1fr',
        gridTemplateAreas: `
          "sidebar header"
          "sidebar main"
        `,
        background: 'var(--color-neutral-50)',
        ...style,
      }}
    >
      {/* Header */}
      <div style={{ gridArea: 'header' }}>
        <AppBar onToggleSidebar={toggle} />
      </div>

      {/* Sidebar drawer on mobile overlay */}
      {isMobile && sidebarOpen ? (
        <div
          aria-hidden={!sidebarOpen}
          onClick={toggle}
          style={{
            position: 'fixed', inset: 0, top: 64, zIndex: 15,
            background: 'rgba(17,24,39,0.35)',
          }}
        />
      ) : null}

      <aside
        style={{
          gridArea: 'sidebar',
          position: isMobile ? 'fixed' : 'sticky',
          top: isMobile ? 64 : 0,
          left: 0, bottom: 0,
          width: 260,
          zIndex: isMobile ? 16 : 10,
          background: '#fff',
          borderRight: '1px solid var(--color-neutral-200)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transform: isMobile && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform .2s ease',
          height: isMobile ? 'calc(100vh - 64px)' : '100vh',
        }}
      >
        <SidebarNav open style={{ flex: 1, minHeight: 0 }} />
      </aside>

      {/* Main */}
      <main
        style={{
          gridArea: 'main',
          minWidth: 0,
          padding: 'var(--space-6)',
        }}
      >
        <div style={{
          maxWidth: 1440, margin: '0 auto',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        }}>
          <style dangerouslySetInnerHTML={{ __html: `
            .shell-breadcrumb-mobile{display:block}
            @media(min-width:768px){.shell-breadcrumb-mobile{display:none!important}}
          `}} />
          <div className="shell-breadcrumb-mobile">
            <BreadcrumbsShell />
          </div>
          <section style={{ minWidth: 0 }}>
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
