/**
 * Email sender utility for Cloudflare Workers.
 *
 * Uses the Resend HTTP API (https://api.resend.com/emails) to send
 * transactional emails. The API key is stored as the `EMAIL_API_KEY`
 * env var; the sender address defaults to `EMAIL_FROM` env var.
 *
 * When no `EMAIL_API_KEY` is configured (local dev / unit tests),
 * `sendEmail` is a graceful no-op that resolves to `false`.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

export interface EmailConfig {
  /** Resend API key (or compatible HTTP email API key). */
  apiKey?: string;
  /** Sender email address. */
  from: string;
}

/** Default sender address for OntoDecide transactional emails. */
export const DEFAULT_EMAIL_FROM = 'venslu.pro@gmail.com';

/**
 * Send an email via the Resend HTTP API.
 *
 * @returns `true` on success, `false` when email is not configured or
 *   the API call fails (callers should not hard-fail user-facing
 *   operations on email delivery — the credentials are still returned
 *   in the API response as a fallback).
 */
export async function sendEmail(message: EmailMessage, config: EmailConfig): Promise<boolean> {
  if (!config.apiKey) {
    // Graceful no-op in local dev / unit-test environments.
    return false;
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Build the account-credential notification email body.
 *
 * Sent after a user submits an account application. Contains the
 * auto-generated username, temporary password, and expiration date.
 */
export function buildCredentialEmail(
  username: string,
  password: string,
  expiresAt: string,
): { subject: string; text: string; html: string } {
  const expiry = new Date(expiresAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const subject = 'OntoDecide Account Credentials';
  const text = [
    'Welcome to OntoDecide!',
    '',
    'Your account has been created. Please log in and change your',
    'password to activate the account.',
    '',
    `Username: ${username}`,
    `Temporary password: ${password}`,
    `Expires at: ${expiry} (UTC)`,
    '',
    'After expiration, your account and all associated data will be',
    'automatically deleted.',
  ].join('\n');
  const html = [
    '<h2>Welcome to OntoDecide!</h2>',
    '<p>Your account has been created. Please log in and change your',
    'password to activate the account.</p>',
    `<p><strong>Username:</strong> ${username}<br>`,
    `<strong>Temporary password:</strong> ${password}<br>`,
    `<strong>Expires at:</strong> ${expiry} (UTC)</p>`,
    '<p><em>After expiration, your account and all associated data',
    'will be automatically deleted.</em></p>',
  ].join('\n');
  return { subject, text, html };
}
