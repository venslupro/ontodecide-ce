/**
 * Page401 — unauthorized error page (no shell). Centered illustration,
 * 401 glyph, permission message and a sign-in CTA.
 */
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';

export default function Page401() {
  const navigate = useNavigate();
  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 'var(--space-4)',
        background: 'linear-gradient(180deg, #fff 0%, var(--color-neutral-50) 100%)',
      }}
    >
      <div
        style={{
          maxWidth: 520, width: '100%', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <img
          src="https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=480&q=80&auto=format&fit=crop"
          alt="Access denied illustration"
          style={{
            width: 220, height: 150, objectFit: 'cover',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-md)',
          }}
        />
        <div
          style={{
            fontSize: 140, fontWeight: 800, lineHeight: 1,
            letterSpacing: '-0.04em',
            background: 'linear-gradient(135deg, var(--color-danger) 0%, var(--color-warning) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
          aria-hidden="true"
        >
          401
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
          Access denied
        </h1>
        <p style={{
          fontSize: 15, color: 'var(--color-neutral-500)',
          maxWidth: 420, lineHeight: 1.6,
        }}>
          You are not authorized to view this resource. Please sign in with
          an account that has the correct permissions, or contact your workspace
          administrator.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 4 }}>
          <Button variant="primary" size="md" onClick={() => navigate('/login', { replace: true })}>
            Sign in
          </Button>
          <Button variant="outline" size="md" onClick={() => navigate('/dashboard', { replace: true })}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
