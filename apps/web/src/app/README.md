# App shell: exports for the business pages

Router (`app/router.tsx`) lazy-loads these named exports:

| Route | File | Export |
| --- | --- | --- |
| `/cockpit` | `pages/cockpit/cockpit_page.tsx` | `CockpitPage` |
| `/objects` (search `type`, `q`, `filter`, `orderBy`) | `pages/objects/objects_page.tsx` | `ObjectsPage` |
| `/objects/$rid` | `pages/object-view/object_view_page.tsx` | `ObjectViewPage` |
| `/graph` (search `rid`, `depth`, `linkTypes`) | `pages/graph/graph_page.tsx` | `GraphPage` |
| `/scenarios`, `/scenarios/$id` | `pages/scenarios/scenario_page.tsx` | `ScenarioPage` |
| `/recommendations`, `/recommendations/$id` | `pages/recommendations/recommendations_page.tsx` | `RecommendationsPage` |
| `/imports` · `/imports/new` · `/imports/$id` | `pages/imports/{imports_page,import_wizard_page,import_job_page}.tsx` | `ImportsPage` · `ImportWizardPage` · `ImportJobPage` |
| `/ontology` | `pages/ontology/ontology_page.tsx` | `OntologyPage` |
| `/automations` | `pages/automations/automations_page.tsx` | `AutomationsPage` |

Read params with `useParams({strict: false})` / `useSearch({strict: false})`.

Shell exports:

- `app/layouts/banners.tsx` → `ExpiryBanner` (amber, renders only for owners with ≤ 24 h left; includes "立即导出").
- `entities/quota` → `useQuotas()` (`GET /me`, query key `['me']`) and `QuotaBars` (`keys?` defaults to objects, links, aiRecsToday, importRowsToday).
- `shared/ws` → `useSituationStream(scope?)` returns `{state}`. The app layout owns the connection; calling it without a scope only reads the state. Frames are merged into every cached query under `['situation', 'overview', …]` (`kpis` by id, `alerts` prepended by id, ≤ 200), into `['situation', 'live-alerts']`, and they invalidate `['situation', 'alerts']`, `['decision', 'rec', id]`, `['decision', 'recs']`, `['me']`. `registerStreamMerger(fn)` adds page-specific merging. `useRealtimeStatus` is the zustand store behind the state.
- `shared/api/query_keys.ts` → `qk` (module-prefixed keys) and `BUSINESS_PREFIXES` (the keys cleared on entering or leaving the admin view).
- `shared/api/client.ts` → `api`, `apiRequest` (returns the ETag `version`), `idempotencyKey()`. `X-Act-As-Tenant` is added for you.
- `shared/lib/format.ts` → `fmt` (adds `remaining`, `dateTimeTz`, `shortDateTime`, `tzName`, `bytes`) and `shortTid`.
- `shared/lib/telemetry.ts` is a no-op shim: CE has no telemetry. Don't add new `track()` calls.
- Tests: `renderWithProviders(ui, {url, as: 'owner' | 'admin' | 'anonymous', me})` and `renderApp(url, …)` from `test/render.tsx`. GET `/me` returns `businessDb.quotas`.
