import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
// boundaries v6 types don't export a valid ESLint Plugin shape
import * as _boundaries from 'eslint-plugin-boundaries';
import functional from 'eslint-plugin-functional';
import n from 'eslint-plugin-n';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const boundaries = _boundaries as Record<string, unknown>;

export default defineConfig(
  // ── Base configs ──────────────────────────────────────────────
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  prettier,

  // ── Global ignores ────────────────────────────────────────────
  {
    ignores: [
      '**/dist/',
      'node_modules/',
      'firmware/**',
      'packs/**',
      '.claude/worktrees/**',
    ],
  },

  // ── Type-checked linting ──────────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        // `allowDefaultProject` covers the root-level config files, which are
        // deliberately in no tsconfig (the root tsconfig is references-only).
        // Without it they fail to parse and lint dies before reaching any rule.
        projectService: {
          allowDefaultProject: ['*.config.ts'],
          // Without an explicit defaultProject these files get an inferred
          // project whose module setting predates `import.meta`, which makes
          // `import.meta.dirname` below an error type and trips
          // no-unsafe-assignment. Point them at the real base options instead.
          defaultProject: 'tsconfig.base.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── All TypeScript files ──────────────────────────────────────
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { functional, sonarjs, boundaries, unicorn, n },
    settings: {
      'import/resolver': { typescript: true },
      'boundaries/elements': [
        { type: 'protocol', pattern: 'packages/protocol/**' },
        { type: 'packs', pattern: 'packages/packs/**' },
        { type: 'renderer', pattern: 'packages/renderer/**' },
        { type: 'device', pattern: 'packages/device/**' },
        { type: 'daemon', pattern: 'packages/daemon/**' },
        { type: 'hooks', pattern: 'packages/hooks/**' },
        { type: 'cli', pattern: 'packages/cli/**' },
      ],
    },
    rules: {
      // ── TypeScript ──────────────────────────────────────────
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',

      // ── Complexity limits ───────────────────────────────────
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['error', 3],
      'max-depth': ['error', 3],

      // ── Functional rules ────────────────────────────────────
      'functional/no-let': 'error',
      'functional/immutable-data': [
        'error',
        { ignoreImmediateMutation: true, ignoreClasses: true },
      ],
      'functional/prefer-readonly-type': ['warn', { allowLocalMutation: true }],
      'functional/no-loop-statements': 'warn',

      // ── Array callback safety ───────────────────────────────
      'unicorn/no-array-callback-reference': 'error',

      // ── Portability ─────────────────────────────────────────
      'n/no-path-concat': 'error',

      // ── Architecture boundaries ─────────────────────────────
      // Dependency direction (see docs/ARCHITECTURE.md):
      //   protocol <- packs <- renderer <- daemon <- cli
      //   protocol <- device <- daemon
      //   protocol <- hooks
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: { type: 'protocol' },
              allow: [{ to: { type: 'protocol' } }],
            },
            {
              from: { type: 'packs' },
              allow: [{ to: { type: 'packs' } }, { to: { type: 'protocol' } }],
            },
            {
              from: { type: 'renderer' },
              allow: [
                { to: { type: 'renderer' } },
                { to: { type: 'packs' } },
                { to: { type: 'protocol' } },
              ],
            },
            {
              from: { type: 'device' },
              allow: [{ to: { type: 'device' } }, { to: { type: 'protocol' } }],
            },
            // hooks is deliberately near-leaf: it is the binary Claude Code
            // executes on every hook event, so its import graph must stay
            // tiny. It forwards events and nothing else.
            {
              from: { type: 'hooks' },
              allow: [{ to: { type: 'hooks' } }, { to: { type: 'protocol' } }],
            },
            {
              from: { type: 'daemon' },
              allow: [
                { to: { type: 'daemon' } },
                { to: { type: 'renderer' } },
                { to: { type: 'packs' } },
                { to: { type: 'device' } },
                { to: { type: 'protocol' } },
              ],
            },
            {
              from: { type: 'cli' },
              allow: [
                { to: { type: 'cli' } },
                { to: { type: 'daemon' } },
                { to: { type: 'renderer' } },
                { to: { type: 'packs' } },
                { to: { type: 'device' } },
                { to: { type: 'protocol' } },
              ],
            },
          ],
        },
      ],
    },
  },

  // ── Pixel-buffer overrides ────────────────────────────────────
  // `protocol` and `renderer` manipulate typed arrays in tight loops: RLE
  // encoding, dirty-rect diffing, blitting. `functional/no-let` and
  // `immutable-data` are actively wrong there — you cannot write to a
  // Uint16Array framebuffer without mutation, and allocating a new buffer per
  // pixel would defeat the entire point of a 172x320 renderer running at
  // 10fps. Scoped off here rather than globally weakened.
  {
    files: ['packages/protocol/src/**/*.ts', 'packages/renderer/src/**/*.ts'],
    rules: {
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/no-loop-statements': 'off',
      'functional/prefer-readonly-type': 'off',
    },
  },

  // ── Test file overrides ───────────────────────────────────────
  {
    files: ['packages/*/src/**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      'functional/immutable-data': 'off',
      'functional/no-let': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'sonarjs/no-duplicate-string': 'off',
      // Vitest matchers (expect.objectContaining, expect.any) return `any`.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
