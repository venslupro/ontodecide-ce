/**
 * ChangePasswordPage — self-service password rotation.
 * Validates strength via a 4-segment progress bar, matches confirmation,
 * then calls useAuthStore.changePassword and shows success banner.
 */
import { useState, FormEvent, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Progress from '@/components/ui/Progress';
import Alert from '@/components/ui/Alert';

/** Computes a 4-level score for a password (0..4). */
function scorePassword(pwd: string): { score: number; label: string; tone: 'danger' | 'warning' | 'primary' | 'success' } {
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  if (pwd.length === 0) return { score: 0, label: 'Enter a password', tone: 'danger' };
  switch (score) {
    case 1: return { score: 1, label: 'Weak — add variety', tone: 'danger' };
    case 2: return { score: 2, label: 'Fair — longer & mixed', tone: 'warning' };
    case 3: return { score: 3, label: 'Good', tone: 'primary' };
    default: return { score: 4, label: 'Strong', tone: 'success' };
  }
}

const Spinner = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }} aria-hidden="true">
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M22 12a10 10 0 0 0-10-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const loading = useAuthStore((s) => s.loading);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const changePassword = useAuthStore((s) => s.changePassword);

  const [current, setCurrent] = useState('');
  const [nextPwd, setNextPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [success, setSuccess] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const strength = useMemo(() => scorePassword(nextPwd), [nextPwd]);
  const mismatch = confirm.length > 0 && confirm !== nextPwd;
  const canSubmit = !loading && current.length > 0 && strength.score >= 2 && confirm === nextPwd;

  /** Submits the password rotation form. */
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSuccess(false);
    try {
      await changePassword(current, nextPwd);
      setSuccess(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 1800);
    } catch {
      // errorMessage surfaced by store
    }
  };

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 128px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div
          style={{
            background: '#fff', borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--color-neutral-200)',
            boxShadow: 'var(--shadow-lg)', padding: 'var(--space-5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-4)' }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: 'var(--color-primary-50)', color: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}>🔐</div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
                Change password
              </h1>
              <p style={{ fontSize: 13, color: 'var(--color-neutral-500)', marginTop: 2 }}>
                Create a strong new password for your OntoDecide account.
              </p>
            </div>
          </div>

          {success && (
            <Alert tone="success" title="Password updated" style={{ marginBottom: 'var(--space-3)' }}>
              Your password has been changed. Redirecting you to the dashboard…
              <div style={{ marginTop: 6 }}>
                <Link to="/dashboard">Click here if you are not redirected.</Link>
              </div>
            </Alert>
          )}

          {errorMessage && !success && (
            <Alert tone="danger" title="Could not update password" style={{ marginBottom: 'var(--space-3)' }}>
              {errorMessage}
            </Alert>
          )}

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label htmlFor="cp-current" style={labelStyle}>Current password</label>
              <Input
                id="cp-current"
                type={showCurrent ? 'text' : 'password'}
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                leftIcon={<span style={{ color: 'var(--color-neutral-500)', fontSize: 15 }}>🔑</span>}
                rightIcon={
                  <button
                    type="button"
                    aria-label={showCurrent ? 'Hide' : 'Show'}
                    onClick={() => setShowCurrent((v) => !v)}
                    style={eyeBtn}
                  >{showCurrent ? '🙈' : '👁'}</button>
                }
              />
            </div>

            <div>
              <label htmlFor="cp-next" style={labelStyle}>New password</label>
              <Input
                id="cp-next"
                type={showNext ? 'text' : 'password'}
                required
                value={nextPwd}
                onChange={(e) => setNextPwd(e.target.value)}
                autoComplete="new-password"
                leftIcon={<span style={{ color: 'var(--color-neutral-500)', fontSize: 15 }}>🆕</span>}
                rightIcon={
                  <button
                    type="button"
                    aria-label={showNext ? 'Hide' : 'Show'}
                    onClick={() => setShowNext((v) => !v)}
                    style={eyeBtn}
                  >{showNext ? '🙈' : '👁'}</button>
                }
                invalid={nextPwd.length > 0 && strength.score < 2}
              />
              <div style={{ marginTop: 10 }}>
                <Progress value={(strength.score / 4) * 100} tone={strength.tone} />
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  marginTop: 6, fontSize: 12, color: 'var(--color-neutral-500)',
                }}>
                  <span>Strength</span>
                  <span style={{ fontWeight: 600, color: strengthText(strength.tone) }}>{strength.label}</span>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="cp-confirm" style={labelStyle}>Confirm new password</label>
              <Input
                id="cp-confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                leftIcon={<span style={{ color: 'var(--color-neutral-500)', fontSize: 15 }}>✅</span>}
                invalid={mismatch}
              />
              {mismatch && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-danger)', fontWeight: 500 }}>
                  Passwords do not match.
                </div>
              )}
            </div>

            <Button type="submit" size="lg" disabled={!canSubmit} style={{ marginTop: 4 }}>
              {loading ? <Spinner /> : null}
              {loading ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 6,
};
const eyeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--color-neutral-500)', fontSize: 14, padding: 0,
};
function strengthText(tone: 'danger' | 'warning' | 'primary' | 'success'): string {
  switch (tone) {
    case 'danger': return 'var(--color-danger)';
    case 'warning': return 'var(--color-warning)';
    case 'success': return 'var(--color-success)';
    default: return 'var(--color-primary)';
  }
}
