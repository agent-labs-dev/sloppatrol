/**
 * Path globs, the way `.gitignore` reads them: `*` stays inside one folder,
 * `**` crosses folders, and a pattern without a slash matches the file name
 * in any folder.
 */
const cache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const anchored = pattern.includes('/') ? pattern.replace(/^\//, '') : `**/${pattern}`;
  let source = '';
  for (let i = 0; i < anchored.length; i++) {
    const char = anchored[i]!;
    if (char === '*' && anchored[i + 1] === '*') {
      const slash = anchored[i + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A folder pattern also covers everything inside the folder.
  return new RegExp(`^${source}(?:/.*)?$`);
}

export function matchesGlob(path: string, pattern: string): boolean {
  let regex = cache.get(pattern);
  if (!regex) {
    regex = compile(pattern);
    cache.set(pattern, regex);
  }
  return regex.test(path);
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

/** Test files in the common layouts of every stack the playbook covers. */
export const DEFAULT_TEST_PATTERNS = [
  '*.test.*',
  '*.spec.*',
  '*_test.*',
  'test_*.py',
  '*Test.kt',
  '*Test.java',
  '*Tests.swift',
  '*Test.swift',
  '__tests__',
  '__mocks__',
  'tests',
  'test',
  'spec',
  'testing',
  'fixtures',
  'conftest.py',
] as const;
