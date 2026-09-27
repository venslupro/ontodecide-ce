# Roles and accounts (Community Edition V2.4)

The Community Edition has exactly two human roles and one kind of service
principal (修订说明书 6). There are no passwords, no role hierarchy, no
invitations and no property markings.

| | **Admin** (bootstrap admin) | **Owner** |
|---|---|---|
| Level | System-wide, highest privilege | One trial workspace |
| Count | Exactly one in the system | Exactly one per trial workspace |
| Created by | `ensureBootstrapAdmin` from the secret `BOOTSTRAP_ADMIN_EMAIL` (cron start and first request of an isolate; idempotent) | E-mail code sign-up |
| Lifetime | Never expires | 72-hour trial |
| Deletable / demotable | No — database triggers refuse it | Yes: deleted when the trial ends, or by the Admin |
| Data scope | Everything: any workspace (Act-as-Tenant), archives, full e-mails, sessions, audit log, platform settings | Only its own workspace |
| Sign-in | E-mail code **and** passkey (WebAuthn); session ≤ 8 h; high-risk actions need a fresh passkey step-up | E-mail code; session ≤ trial end |
| Audit | Every admin write, Act-as entry (≤ 1 per workspace per hour), Act-as write, full e-mail view and archive download → `admin_audit` (append-only hash chain, 90 days) | Action executions → the workspace audit log |

Service principals (`svc:<worker>`) run lifecycle, archive, purge and queue
work for the workspace named in the call context. They cannot sign in and are
not reachable from the internet. Operators are not an application role: they
deploy and run the controlled scripts, and must use the Admin account for any
data access through the application.

## Permission matrix

| Capability | Owner | Admin | Service |
|---|---|---|---|
| Use the product (cockpit, ontology, import, scenarios, recommendations) | own workspace | any workspace (`X-Act-As-Tenant`) | — |
| Export data (`GET /me/export`) | own workspace | any workspace | during archiving |
| See full e-mail, sessions | own | all accounts | identity-access only |
| Extend / shorten a trial | — | ✓ (revokes that user's sessions) | — |
| End a trial | own, with a `terminate` e-mail code | any Owner | on expiry |
| Revoke sessions, ban an e-mail, block domains | — | ✓ | — |
| Delete an account (with or without archive) | — (only end the trial early) | any Owner | expiry flow |
| View / download / delete archives | own, through the e-mail links | any archive (15-minute links) | ✓ |
| Platform settings (sign-up switch, daily limit 0–20, active limit 0–60) | — | ✓ (If-Match + step-up) | — |
| Delete, demote or expire the Admin | — | ✗ (not even itself) | ✗ |

## Guarantees in the database (identity-access-db)

* `ux_one_admin` / `ux_one_admin_ws`: partial unique indexes — one admin
  account and one admin workspace, even under concurrent bootstrap.
* `trg_admin_no_delete`, `trg_admin_no_demote`, `trg_admin_ws_no_delete`,
  `trg_admin_ws_no_expire`: the admin cannot be deleted, demoted or expired.
* The admin workspace has `trial_expires_at = NULL`; its access token has no
  `texp`; every lifecycle query filters `kind = 'trial'`, so the admin
  workspace is never expired, archived or counted in the active-workspace
  limit.
* The API refuses too: `adminPatchUser` / `adminDeleteUser` /
  `adminRevokeSessions` on the admin → `FORBIDDEN`; `POST /me/codes` and
  `POST /me/trial/termination` by the admin → `FORBIDDEN`.

## Admin account protection

1. **First passkey**: e-mail code → pre-auth token (5 min) → passkey
   registration that also requires the one-time `BOOTSTRAP_ADMIN_SETUP_CODE`
   (constant-time comparison). The code is burned (`system_flag
   setup_code_used`) when the first passkey is bound; operations then delete
   the secret.
2. **Second passkey**: bound with a step-up; the response carries 10 offline
   recovery codes exactly once (only HMACs are stored, each usable once).
3. **Sign-in**: e-mail code + passkey assertion with user verification; a sign
   counter that does not increase is rejected (cloned authenticator). A
   recovery code replaces the passkey once; while that recovery session is
   alive, a new passkey may be bound without a step-up.
4. **Sessions**: ≤ 8 h; api-gateway calls `verifyAdminSession(sid)` on every
   admin request, so revocation is immediate. A sign-in with a passkey that
   was never used before (or a recovery code) sends `admin_new_device` to the
   admin address.
5. **High-risk writes** (patch / delete user, delete archive, settings,
   passkey add / delete) need an `X-Step-Up` token: a passkey assertion with
   user verification from the last 5 minutes, bound to the admin. Every
   `/admin` write takes an `Idempotency-Key`; a replay returns the first
   result stored in `admin_audit`.
6. **At least 2 passkeys** must remain (`adminDeletePasskey` → `CONFLICT`).
7. **Controlled changes**: changing the admin e-mail or resetting the passkeys
   is possible only through the operations script, which writes
   `admin_pending_change`. The cron notifies the current admin address and
   applies the change after a 24-hour cool-down (sessions revoked; a passkey
   reset re-enables the setup code).

## Owners

* Sign-up: Turnstile, disposable-domain and ban checks, ≤ 5 codes per e-mail
  per day, 10 failures lock the address for 24 h, ≤ 5 attempts per code,
  ≤ 2 successful sign-ups per IP per day, daily and active-workspace limits,
  purge backlog < 10, automatic stop at 80 % of any free-tier budget. The
  answer is the same whether or not the address exists.
* One workspace, created with the account in one D1 batch; trial end =
  verification + 72 h. Sign-in never changes the trial.
* ≤ 3 sessions (oldest evicted); refresh tokens rotate within a family and a
  replayed token revokes the family.
* At the end of the trial (expiry, early termination or admin deletion) the
  data is archived to one ZIP, a 7-day download link and a "delete now" link
  are e-mailed once, and the account — including the e-mail address — is
  deleted. See docs/ARCHITECTURE.md §6.6.
