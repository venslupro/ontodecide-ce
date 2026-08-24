/**
 * Page404 — not found error page (no shell). Centered illustration,
 * large 404 glyph, descriptive text and a back-to-home CTA.
 */
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';

export default function Page404() {
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
          src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=480&q=80&auto=format&fit=crop"
          alt="Lost in space illustration"
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
            background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
          aria-hidden="true"
        >
          404
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
          Page not found
        </h1>
        <p style={{
          fontSize: 15, color: 'var(--color-neutral-500)',
          maxWidth: 420, lineHeight: 1.6,
        }}>
          The page you are looking for has been moved, renamed, or never existed.
          Let us get you back to familiar ground.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 4 }}>
          <Button variant="primary" size="md" onClick={() => navigate('/dashboard', { replace: true })}>
            ← Back to dashboard
          </Button>
          <Button variant="outline" size="md" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
