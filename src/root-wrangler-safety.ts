// ==========================================================================
// Root WRANGLER SAFETY HATCH — this file is intentionally referenced by
// `main = "src/root-wrangler-safety.ts"` in the REPO-ROOT wrangler.toml.
//
// Why does this exist?
//   In a multi-Worker monorepo, the hosted Workers Builds runner executes
//   the Dashboard's Deploy command **from root_directory="."**.  If an
//   operator ever forgets to target a specific app's toml with
//       npx wrangler deploy --config apps/api/<name>/wrangler.toml
//   then wrangler falls back to the repo-root wrangler.toml.  Without a
//   `main` field there it throws the cryptic error:
//       ✘ Missing entry-point to Worker script or to assets directory
//   which gives the operator zero hint about *which* of the 6 Workers went
//   wrong and where to look.
//
//   With this sentinel, the same mis-configuration now produces a
//   ACTIONABLE error message the very moment wrangler tries to bundle
//   (i.e. during the Deploy step of Workers Builds, before any upload
//   attempt):
//
//       ┌──────────────────────────────────────────────────────────────┐
//       │  DEPLOY MISCONFIGURATION DETECTED                            │
//       │  You are running wrangler against the REPO-ROOT toml.        │
//       │  In a multi-Worker monorepo you MUST pick ONE app via:       │
//       │    npx wrangler deploy --config apps/api/<X>/wrangler.toml  │
//       │  Valid <X>: gateway | user | graph | ingestion | ai | cleanup
//       └──────────────────────────────────────────────────────────────┘
//
//   Because the throw happens at module *evaluation* time, it is fired
//   by `wrangler deploy`, `wrangler versions upload`, `wrangler dev`,
//   `wrangler deploy --dry-run`, AND `wrangler deploy --outdir` — any
//   path that loads the root wrangler.toml will stop here instead of
//   silently succeeding with a "nothing" bundle.
//
// Authoritative per-app Deploy commands live in:
//   • .cloudflare/workers-builds.yaml         (paste into Dashboard)
//   • apps/api/<X>/wrangler.toml              (one per Worker)
// ==========================================================================

const VALID_WORKERS = [
  "gateway",
  "user",
  "graph",
  "ingestion",
  "ai",
  "cleanup",
] as const;

// Wrangler bundles workers BEFORE evaluating them at runtime.  Therefore
// a top-level throw() at module-evaluation time is NOT triggered until
// the bundle is EXECUTED by workerd (i.e. after a successful upload).
//
// In order to FAIL EARLY and PREVENT WRANGLER FROM UPLOADING THIS SENTINEL
// BUNDLE to Cloudflare (especially from a Workers Builds run where the
// operator forgot the --config flag), we deliberately reference a file
// path that does NOT exist via a dynamic import() with no catch handler.
//
// Modern Wrangler (3.90+) traces import graph statically where possible,
// but un-guarded import() to a non-existent file reliably fails the
// **bundle** step with a build error, which surfaces BEFORE any
// `Total Upload:` line — i.e. the Deploy step fails during bundle, not
// after, giving the operator fast feedback.
//
// We still render the banner to console.log first so it appears in
// Workers Builds deploy logs directly above the failing import() error,
// which is the exact same log stream the user shared on 2026-08-20.
//
// The error text is deliberately grep-able ("ROOT_WRANGLER_SAFETY_")
// so operators can search the log for this string and immediately
// recognise the misconfiguration, vs. a generic "can't resolve module".
const banner = `
==========================================================================
 ROOT_WRANGLER_SAFETY_FAILURE — ontodecide monorepo
==========================================================================
 You ran bare \`wrangler deploy\` against the REPO-ROOT wrangler.toml.
 This repo ships 6 SEPARATE Workers under apps/api/<X> each with its
 own wrangler.toml.  The root wrangler.toml does not own any real
 deployable code — this file only exists to show you this banner.

 FIX (use one of):

   npx wrangler deploy --config apps/api/gateway/wrangler.toml
   npx wrangler deploy --config apps/api/user/wrangler.toml
   npx wrangler deploy --config apps/api/graph/wrangler.toml
   npx wrangler deploy --config apps/api/ingestion/wrangler.toml
   npx wrangler deploy --config apps/api/ai/wrangler.toml
   npx wrangler deploy --config apps/api/cleanup/wrangler.toml

 IF you see this inside CLOUDFLARE WORKERS BUILDS deploy logs:
   → The Worker's Settings → Builds → Deploy command was pasted
     WITHOUT the required --config flag.  Go back to Dashboard for
     ALL 6 Workers and paste the Deploy/Preview commands exactly as
     shown in the repo file .cloudflare/workers-builds.yaml.

 IF you see this LOCALLY:
   → cd apps/api/<X> first, then wrangler deploy.
   → Or: use pnpm run deploy --filter=@ontodecide/<X>
        (package.json#deploy injects --config for you)
==========================================================================
 Valid Workers: ${VALID_WORKERS.join(", ")}
==========================================================================
`;

// eslint-disable-next-line no-console
console.error(banner);

// IMPORT: force a build-time failure.  The string "ROOT_WRANGLER_SAFETY_"
// is greppable so operators can search logs for this misconfiguration.
// Point at a non-existent path so wrangler's esbuild step fails during
// trace, before any upload.
//
// NOTE: This file also explicitly declares a `default export` below so
// that wrangler's hybrid-nodejs_compat plugin does NOT additionally
// complain about "worker has no default export, assumed Service Worker"
// — the actual, actionable, first error in the log is still the
// intentional Could-not-resolve error below.
void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  const _misconfigTrigger = await import(
    /* webpackIgnore: true */
    // @ts-expect-error — intentionally non-existent path to force a
    // build step failure and prevent Workers Builds from uploading
    // a sentinel bundle when the operator forgot --config.
    "./ROOT_WRANGLER_SAFETY_TRIGGER_MISSING_CONFIG_FLAG_DOES_NOT_EXIST.js"
  );
})();

// Default export: never reached at runtime (the import above fails during
// bundle).  Keeps the ESM module shape valid for wrangler's plugin layer.
export default {
  async fetch() {
    return new Response(
      "root-wrangler-safety: unexpected reach. " +
        "Use --config apps/api/<X>/wrangler.toml. " +
        "Valid <X>: gateway|user|graph|ingestion|ai|cleanup",
      { status: 500 },
    );
  },
};
