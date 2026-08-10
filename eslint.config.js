// ESLint config ("flat" format, ESLint 9).
//
// Why this file exists: `tsc --noEmit` alone let dead imports and unused variables through,
// because `noUnusedLocals` isn't enabled in Expo's base config. Turning it on in tsconfig
// would block typechecking while writing code (every momentarily unused variable becomes an
// error), so these rules live here instead — in a tool that runs deliberately.
//
// The split is intentional:
//   * rules catching **bugs** are `error` — meant to stop `make check`,
//   * rules about **appearance** (line length) are `warning` — they block nothing.
//
// Some rules need type information, hence `projectService` below. It slows the run down by a
// few seconds, but without it `no-floating-promises` doesn't work — and in an app full of
// asynchronous database writes, that's the single most valuable rule in the whole set.

const expo = require('eslint-config-expo/flat');

module.exports = [
  ...expo,
  {
    ignores: [
      'ios/**',
      'android/**',
      '.expo/**',
      'dist/**',
      'assets/content/**',
      'node_modules/**',
      'eslint.config.js',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // ── Bugs ─────────────────────────────────────────────────────────────────

      // This caught five dead imports in the exam screens. A leading underscore in a name is
      // an escape hatch for things kept on purpose (e.g. a deliberately unused argument).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // The most important rule in this project. Progress writes go through `saveCard`,
      // `saveAttempt` and friends — a promise left without `void` or `await` swallows a save
      // error silently, and the user only finds out later, as lost progress.
      '@typescript-eslint/no-floating-promises': 'error',
      // An async function passed where a synchronous one is expected (e.g. in `onPress` or
      // in `Alert.alert` buttons) — a rejection there has nowhere to go.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      // `default` counts as exhaustive: `routeFor` deliberately returns null through it for
      // targets handled outside of navigation, and `fontScaleLabel` uses it for the top scale.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'require-atomic-updates': 'error',
      'array-callback-return': 'error',

      // ── Appearance ───────────────────────────────────────────────────────────

      // The code targets 100 columns (p99 of line length is 98). URLs and long strings are
      // exempt, since wrapping them hurts readability rather than helping it.
      'max-len': [
        'warn',
        { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true },
      ],

      // ── Deliberate exceptions ────────────────────────────────────────────────

      // `no-unnecessary-condition` is switched off deliberately, after reviewing all eleven
      // hits — every one of them was a false positive, for two reasons:
      //
      //   * the `let cancelled = false` pattern in effects. TypeScript doesn't see that the
      //     effect's cleanup sets this variable inside a closure, so it treats
      //     `if (cancelled)` as dead code. The pattern is correct and guards against writing
      //     state after the screen has unmounted.
      //   * defensive checks on data from the content bundle. The bundle comes in through
      //     `require` and an `as ContentBundle` cast, so the type *declares* a full set of
      //     fields — but an older bundle on disk may not have them. `bundle.glossary ?? []`
      //     isn't dead code, it's the only thing standing between a missing field and a
      //     crash.
      //
      // The rule would force removing exactly these safeguards, working against itself.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // Some screens deliberately omit dependencies, so the effect doesn't reload the deck on
      // every render. The warning is meant to flag this during review, not to block it.
      'react-hooks/exhaustive-deps': 'warn',

      // `icon()` in the tab layout returns a render prop for `tabBarIcon`, not a component.
      // The rule sees a function returning JSX and demands a name there's no reason to give.
      'react/display-name': 'off',

      // The interface is in Polish, so „ and " quote marks are content, not entities that
      // need escaping. The rule is written for English apostrophes and produces nothing but
      // false positives here.
      'react/no-unescaped-entities': 'off',
    },
  },
];

// Watch the `eslint-config-expo` version: it's pinned to `~10.0.0`, since that's what SDK 54
// expects (`npx expo install --check`). The newer one (57) brings in rules from the React
// compiler — `react-hooks/purity` and `react-hooks/set-state-in-effect` — but conflicts with
// the SDK. Both only flagged deliberate patterns (a timestamp in `useRef`, setting state
// after content materialization), so staying in step with the SDK is worth more here than
// those rules.
