import { describe, expect, it } from 'vitest';
import { DEFAULT_TEST_PATTERNS, matchesAny, matchesGlob } from '../../globs/index.js';

describe('globs', () => {
  it('match a bare name in any folder, and a folder with all it holds', () => {
    expect(matchesGlob('a/b/package.json', 'package.json')).toBe(true);
    expect(matchesGlob('.github/workflows/ci.yml', '.github')).toBe(true);
    expect(matchesGlob('src/github.ts', '.github')).toBe(false);
  });

  it('keep * inside one folder and let ** cross folders', () => {
    expect(matchesGlob('gen/api.ts', 'gen/*.ts')).toBe(true);
    expect(matchesGlob('gen/v1/api.ts', 'gen/*.ts')).toBe(false);
    expect(matchesGlob('gen/v1/api.ts', 'gen/**')).toBe(true);
    expect(matchesGlob('src/a/b/c.sql', '**/*.sql')).toBe(true);
  });

  it('tell test files in each stack from source files', () => {
    const isTest = (path: string) => matchesAny(path, DEFAULT_TEST_PATTERNS);
    for (const path of [
      'src/a.test.ts',
      'web/a.spec.tsx',
      'pkg/a_test.go',
      'tests/test_a.py',
      'app/src/test/AT.kt',
      'XTests.swift',
    ])
      expect(isTest(path), path).toBe(true);
    for (const path of ['src/a.ts', 'pkg/a.go', 'src/testimony.ts', 'app/Main.kt'])
      expect(isTest(path), path).toBe(false);
  });
});
