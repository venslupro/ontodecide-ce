/**
 * @fileoverview E-mail address normalization and the disposable-domain
 * blocklist that ships with the code (修订说明书 8.3).
 */

/**
 * Well-known disposable e-mail domains. Admins extend this list at runtime
 * through `PUT /admin/blocked-domains` (table blocked_domain).
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'dispostable.com',
  'discard.email',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.dev',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  '1secmail.com',
  '33mail.com',
  'burnermail.io',
  'mailpoof.com',
  'inboxkitten.com',
  'emailfake.com',
]);

/** Normalizes an address for HMAC uniqueness: trimmed, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Domain part of a normalized address ('' when malformed). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1);
}

/**
 * The domain and every parent domain with at least two labels
 * (`a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`),
 * so a blocked domain also blocks its sub-domains.
 */
export function domainCandidates(domain: string): string[] {
  const labels = domain.split('.').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 2 <= labels.length; i++) {
    out.push(labels.slice(i).join('.'));
  }
  return out;
}

/** Whether the built-in list blocks the domain (or a parent domain). */
export function isDisposableDomain(domain: string): boolean {
  return domainCandidates(domain).some(d => DISPOSABLE_DOMAINS.has(d));
}

/** Masks an address for logs of the local `log` mailer (`a***@example.com`). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
