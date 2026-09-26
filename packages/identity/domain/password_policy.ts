/**
 * @fileoverview Password policy (10–128 chars with lower, upper and digit)
 * and temporary password generation. Mirrors `passwordSchema` in the
 * contract; the contract schema validates input, this module generates.
 */

/** Minimum password length. */
export const PASSWORD_MIN_LENGTH = 10;

/** Maximum password length. */
export const PASSWORD_MAX_LENGTH = 128;

/** Length of generated temporary passwords. */
export const TEMP_PASSWORD_LENGTH = 16;

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LOWER + UPPER + DIGITS;

/** Returns the policy violations of a password (empty when valid). */
export function passwordViolations(password: string): string[] {
  const out: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) out.push('Too short');
  if (password.length > PASSWORD_MAX_LENGTH) out.push('Too long');
  if (!/[a-z]/.test(password)) out.push('Needs a lowercase letter');
  if (!/[A-Z]/.test(password)) out.push('Needs an uppercase letter');
  if (!/\d/.test(password)) out.push('Needs a digit');
  return out;
}

/** Whether a password satisfies the policy. */
export function isPasswordValid(password: string): boolean {
  return passwordViolations(password).length === 0;
}

/**
 * Generates a policy-compliant temporary password from a random source.
 * Ambiguous characters (0/O, 1/l/I) are excluded.
 */
export function generateTemporaryPassword(
  random: (n: number) => Uint8Array,
): string {
  const bytes = random(TEMP_PASSWORD_LENGTH * 2);
  const chars: string[] = [];
  const pick = (set: string, b: number) => set[b % set.length];
  chars.push(
    pick(LOWER, bytes[0]),
    pick(UPPER, bytes[1]),
    pick(DIGITS, bytes[2]),
  );
  for (let i = 3; i < TEMP_PASSWORD_LENGTH; i++)
    chars.push(pick(ALL, bytes[i]));
  // Fisher–Yates shuffle driven by the remaining random bytes.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[TEMP_PASSWORD_LENGTH + i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
