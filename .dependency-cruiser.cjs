/**
 * @fileoverview Architecture guard (design: 架构守护, dependency-cruiser).
 * - Cross-context imports only through `<context>/contract`.
 * - Domain layers stay pure (no infrastructure, no Cloudflare runtime).
 * - Layers point inward: interface → application → domain.
 * - Contracts depend only on the shared kernel and other contracts.
 */
const CONTEXTS =
  '(identity|ontology|integration|object-graph|situation|decision)';

/** Worker app → the only context whose internals it may import. */
const APP_CONTEXT = {
  'identity-access': 'identity',
  'ontology-manager': 'ontology',
  'data-integration': 'integration',
  'object-graph': 'object-graph',
  'situation-awareness': 'situation',
  'decision-engine': 'decision',
  'api-gateway': null,
};

/** Tests and test fixtures may cross layers. */
const TEST_FILES = [
  '_test\\.tsx?$',
  '/testing/',
  'test_fixtures\\.ts$',
  '_fixture\\.ts$',
];

const APP_RULES = Object.entries(APP_CONTEXT).map(([app, ctx]) => ({
  name: `${app}-uses-own-context-internals-only`,
  severity: 'error',
  from: {path: `^apps/${app}/`},
  to: {
    path: `^packages/${CONTEXTS}/(domain|application|infrastructure|interface)/`,
    ...(ctx ? {pathNot: [`^packages/${ctx}/`]} : {}),
  },
}));

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: {circular: true},
    },
    {
      name: 'cross-context-only-via-contract',
      comment: 'A context may use another context only through its contract.',
      severity: 'error',
      from: {path: `^packages/${CONTEXTS}/`, pathNot: TEST_FILES},
      to: {
        path: `^packages/${CONTEXTS}/(domain|application|infrastructure|interface)/`,
        pathNot: ['^packages/$1/'],
      },
    },
    ...APP_RULES,
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: {path: `^packages/${CONTEXTS}/domain/`, pathNot: TEST_FILES},
      to: {
        path: [
          `^packages/${CONTEXTS}/(application|infrastructure|interface)/`,
          '^cloudflare:',
          '^packages/testing/',
        ],
      },
    },
    {
      name: 'application-not-infrastructure',
      severity: 'error',
      from: {path: `^packages/${CONTEXTS}/application/`, pathNot: TEST_FILES},
      to: {path: `^packages/${CONTEXTS}/(infrastructure|interface)/`},
    },
    {
      name: 'contract-depends-on-kernel-only',
      severity: 'error',
      from: {path: `^packages/${CONTEXTS}/contract/`},
      to: {
        path: `^packages/${CONTEXTS}/(domain|application|infrastructure|interface)/`,
      },
    },
    {
      name: 'kernel-is-standalone',
      severity: 'error',
      from: {path: '^packages/shared-kernel/'},
      to: {path: `^packages/(${CONTEXTS.slice(1, -1)}|testing)/`},
    },
    {
      name: 'no-testing-in-production-code',
      severity: 'error',
      from: {
        path: '^(apps|packages)/',
        pathNot: ['_test\\.tsx?$', '^packages/testing/', '^tests/'],
      },
      to: {path: '^packages/testing/'},
    },
  ],
  options: {
    doNotFollow: {path: 'node_modules'},
    exclude: {path: ['node_modules', '\\.wrangler', 'dist', 'apps/web']},
    tsPreCompilationDeps: true,
    tsConfig: {fileName: 'tsconfig.json'},
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      mainFields: ['main', 'types'],
    },
    combinedDependencies: true,
  },
};
