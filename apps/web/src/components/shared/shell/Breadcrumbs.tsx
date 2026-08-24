/**
 * Shell breadcrumbs — translates useLocation().pathname into human-readable
 * segments matching the FR-1 route list. Uses aria-label="Breadcrumb".
 */
import { useLocation } from 'react-router-dom';
import Breadcrumbs from '@/components/ui/Breadcrumbs';

const TITLES: Record<string, string> = {
  '': 'Home',
  dashboard: 'Dashboard',
  graph: 'Graph Explorer',
  ontology: 'Ontology Types',
  entities: 'Entities',
  explore: 'Graph Explore',
  situation: 'Situation',
  decisions: 'Decisions',
  scenario: 'Scenarios',
  recommend: 'Recommendations',
  agent: 'Decision Agent',
  ingest: 'Data Sources',
  sync: 'Sync Connectors',
  file: 'File Upload',
  jobs: 'Ingest Job',
  admin: 'Admin',
  users: 'Users',
  audit: 'Audit Log',
  config: 'System Config',
  cleanup: 'Data Cleanup',
  login: 'Login',
  auth: 'Auth',
  'change-password': 'Change password',
};

export default function BreadcrumbsShell({ className, style }: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const items = [
    { label: TITLES[''] ?? 'Home', href: '#/' },
    ...segments.map((seg, idx) => {
      const href = '#/' + segments.slice(0, idx + 1).join('/');
      const isId = /^:/.test(seg) || /^[a-z0-9_-]{6,}$/i.test(seg) &&
        !Object.prototype.hasOwnProperty.call(TITLES, seg);
      const label = (TITLES[seg] ?? (isId ? seg : decodeURIComponent(seg)));
      return { label, href, current: idx === segments.length - 1 };
    }),
  ];
  return <Breadcrumbs items={items} className={className} style={style} />;
}
