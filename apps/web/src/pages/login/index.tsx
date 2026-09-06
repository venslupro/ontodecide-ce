/**
 * LoginPage — authentication entry with split-screen branding + form card.
 * Left: brand illustration, logo, product pitch. Right: email/password form
 * with remember-me, forgot-password, and JWT security notice.
 */
import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { applyTrial } from '@/services/api/authResource';
import Logo from '@/components/shared/Logo';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Checkbox from '@/components/ui/Checkbox';
import Alert from '@/components/ui/Alert';
import Modal from '@/components/ui/Modal';

/** Loading spinner overlayed on the submit button. */
const Spinner = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }} aria-hidden="true">
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M22 12a10 10 0 0 0-10-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export default function LoginPage() {
  const navigate = useNavigate();
  const loading = useAuthStore((s) => s.loading);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const clear = useAuthStore((s) => s.clear);
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Trial account application modal state ---
  const [showApply, setShowApply] = useState(false);
  const [applyEmail, setApplyEmail] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{
    username: string;
    temporary_password: string;
    expires_at: string | null;
  } | null>(null);

  /** Submit handler for the trial application form. */
  const onApply = async (e: FormEvent) => {
    e.preventDefault();
    setApplyError(null);
    setApplyResult(null);
    if (!applyEmail.trim()) {
      setApplyError('请输入邮箱地址。');
      return;
    }
    setApplyLoading(true);
    try {
      const res = await applyTrial({ email: applyEmail.trim() });
      if (res.success && res.data) {
        setApplyResult({
          username: res.data.username,
          temporary_password: res.data.temporary_password,
          expires_at: res.data.expires_at,
        });
      } else {
        setApplyError(res.error?.message ?? '申请失败，请稍后重试。');
      }
    } catch {
      setApplyError('网络错误，请稍后重试。');
    } finally {
      setApplyLoading(false);
    }
  };

  /** Close the apply modal and reset its state. */
  const closeApply = () => {
    setShowApply(false);
    setApplyEmail('');
    setApplyError(null);
    setApplyResult(null);
    setApplyLoading(false);
  };

  /** Submit handler — calls auth store and routes by needsPasswordChange. */
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clear();
    setSubmitError(null);
    try {
      const { needsPasswordChange } = await login({ username: email, password });
      if (needsPasswordChange) navigate('/auth/change-password', { replace: true });
      else navigate('/dashboard', { replace: true });
    } catch {
      setSubmitError(errorMessage ?? 'Login failed. Please check your credentials.');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '40fr 60fr',
        background: 'var(--color-neutral-50)',
      }}
    >
      {/* Left brand panel */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 'var(--space-8) var(--space-6)',
        }}
      >
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 0,
            backgroundImage: 'url(https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80&auto=format&fit=crop)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden="true"
        />
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 1,
            background: 'linear-gradient(135deg, rgba(123,92,224,0.92) 0%, rgba(59,130,246,0.85) 100%)',
          }}
          aria-hidden="true"
        />
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                background: 'rgba(255,255,255,0.18)',
                borderRadius: 12, padding: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <Logo size={36} markOnly tone="light" color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>OntoDecide</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                AI-Driven Intelligent Decision System
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <h1 style={{
              fontSize: 36, fontWeight: 700, color: '#fff',
              lineHeight: 1.2, letterSpacing: '-0.02em',
            }}>
              Turn complex data into confident decisions.
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.7, opacity: 0.92 }}>
              OntoDecide combines knowledge graphs, multi-agent AI reasoning and
              scenario simulation to help teams make faster, auditable decisions
              with measurable outcomes.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { icon: '🧠', title: 'Knowledge Graph', desc: 'Model your domain with entities, properties and rich relationships.' },
              { icon: '⚡', title: 'AI Reasoning', desc: 'Multi-step agents reason over context and explain their path.' },
              { icon: '🎯', title: 'Multi-Scenario Decisions', desc: 'Simulate bullish / bearish outcomes before you commit.' },
            ].map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: 'rgba(255,255,255,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, backdropFilter: 'blur(4px)',
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{f.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 2, fontSize: 12, opacity: 0.75 }}>
          © {new Date().getFullYear()} OntoDecide. All rights reserved.
        </div>
      </div>

      {/* Right form panel */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--space-8) var(--space-4)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div
            style={{
              background: '#fff', borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--color-neutral-200)',
              boxShadow: 'var(--shadow-lg)', padding: 'var(--space-5)',
            }}
          >
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)', marginBottom: 6 }}>
                Welcome back
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-neutral-500)' }}>
                Sign in to continue to your decision workspace.
              </p>
            </div>

            {(submitError || errorMessage) && (
              <Alert tone="danger" onClose={() => setSubmitError(null)} style={{ marginBottom: 'var(--space-3)' }}>
                {submitError || errorMessage}
              </Alert>
            )}

            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="email" style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: 'var(--color-neutral-700)', marginBottom: 6,
                }}>
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<span style={{ color: 'var(--color-neutral-500)', fontSize: 16 }}>✉</span>}
                />
              </div>

              <div>
                <label htmlFor="password" style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: 'var(--color-neutral-700)', marginBottom: 6,
                }}>
                  Password
                </label>
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftIcon={<span style={{ color: 'var(--color-neutral-500)', fontSize: 16 }}>🔒</span>}
                  rightIcon={
                    <button
                      type="button"
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPwd((v) => !v)}
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--color-neutral-500)', fontSize: 14, padding: 0,
                      }}
                    >
                      {showPwd ? '🙈' : '👁'}
                    </button>
                  }
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <Checkbox
                  id="remember"
                  name="remember"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  label="Remember me"
                />
                <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
                  Email-only login
                </span>
              </div>

              <Button type="submit" size="lg" disabled={loading} style={{ marginTop: 4, width: '100%' }}>
                {loading ? <Spinner /> : null}
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div style={{
              marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)',
              borderTop: '1px solid var(--color-neutral-200)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, fontSize: 12, color: 'var(--color-neutral-500)',
            }}>
              <span aria-hidden="true">🔐</span>
              <span>Secured by JWT · End-to-end encrypted</span>
            </div>

            <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                onClick={() => setShowApply(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-primary-600)', fontSize: 13, fontWeight: 600,
                  padding: 0,
                }}
              >
                没有账号？申请体验账号 →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* --- Trial account application modal --- */}
      <Modal
        open={showApply}
        title="申请体验账号"
        onClose={closeApply}
        footer={
          applyResult ? (
            <Button onClick={closeApply}>我知道了</Button>
          ) : (
            <Button type="submit" form="apply-form" disabled={applyLoading}>
              {applyLoading ? '提交中…' : '立即申请'}
            </Button>
          )
        }
      >
        {applyResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Alert tone="success">
              体验账号已创建成功！请使用以下凭据登录，并在首次登录后修改密码。
            </Alert>
            <div
              style={{
                background: 'var(--color-neutral-50)',
                border: '1px solid var(--color-neutral-200)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--color-neutral-500)' }}>用户名</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{applyResult.username}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--color-neutral-500)' }}>临时密码</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--color-primary-700)' }}>
                  {applyResult.temporary_password}
                </span>
              </div>
              {applyResult.expires_at && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'var(--color-neutral-500)' }}>有效期至</span>
                  <span>{new Date(applyResult.expires_at).toLocaleString()}</span>
                </div>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-500)', margin: 0 }}>
              ⚠️ 临时密码仅显示一次，请妥善保管。账号到期后数据将自动清除。
            </p>
          </div>
        ) : (
          <form id="apply-form" onSubmit={onApply} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', margin: 0 }}>
              输入邮箱即可免费申请 14 天体验账号，提交后即时获取登录凭据。
            </p>
            {applyError && (
              <Alert tone="danger" onClose={() => setApplyError(null)}>{applyError}</Alert>
            )}
            <div>
              <label htmlFor="apply-email" style={{
                display: 'block', fontSize: 13, fontWeight: 600,
                color: 'var(--color-neutral-700)', marginBottom: 6,
              }}>
                邮箱
              </label>
              <Input
                id="apply-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={applyEmail}
                onChange={(e) => setApplyEmail(e.target.value)}
              />
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
