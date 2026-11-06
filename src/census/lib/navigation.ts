import { posix } from 'node:path';

/**
 * A free static pre-pass over the code: who imports what, functions that
 * only forward, and symbols named once elsewhere. Regex-based and
 * language-agnostic where that is cheap, so it is a map of where to look,
 * never evidence on its own.
 */
export type Navigation = {
  /** Files imported by other files, by how many distinct files import them. */
  fanIn: FanIn[];
  passThroughs: PassThrough[];
  usedOnce: UsedOnce[];
};
type FanIn = { path: string; importers: number };
type PassThrough = { path: string; line: number; name: string; callee: string };
type UsedOnce = { path: string; line: number; name: string };

type Language = 'js' | 'python' | 'lua';

const EXTENSIONS: Record<string, Language> = {
  '.ts': 'js',
  '.tsx': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'python',
  '.lua': 'lua',
};
const JS_EXTENSIONS = Object.keys(EXTENSIONS).filter((ext) => EXTENSIONS[ext] === 'js');

/** The files the pre-pass understands. Others are skipped. */
export function navigable(path: string): boolean {
  return languageOf(path) !== undefined;
}

function languageOf(path: string): Language | undefined {
  return EXTENSIONS[posix.extname(path)];
}

const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"\n]+)['"]/gm;
const PY_FROM = /^[ \t]*from[ \t]+([.\w]+)[ \t]+import[ \t]+(?:\(([^)]*)\)|([\w \t,*]+))/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;
const LUA_REQUIRE = /\brequire\s*\(?\s*['"]([\w./-]+)['"]/g;

/**
 * Module paths by every trailing run of their segments, so `nebula.tools.x`
 * finds `src/nebula/tools/x.py`. A key two files share resolves to neither.
 */
function suffixIndex(paths: string[], init: string): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const path of paths) {
    const stem = path.slice(0, -posix.extname(path).length);
    const parts = (stem.endsWith(`/${init}`) ? stem.slice(0, -init.length - 1) : stem).split('/');
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(i).join('/');
      const seen = index.get(key);
      index.set(key, seen === undefined || seen === path ? path : null);
    }
  }
  return index;
}

type Resolver = (from: string, text: string) => string[];

function jsImports(files: Set<string>): Resolver {
  const resolve = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith('.')) return undefined;
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    const stem = JS_EXTENSIONS.includes(posix.extname(base)) ? base.slice(0, -posix.extname(base).length) : base;
    const candidates = [base, ...JS_EXTENSIONS.map((e) => stem + e), ...JS_EXTENSIONS.map((e) => `${base}/index${e}`)];
    return candidates.find((c) => files.has(c));
  };
  return (from, text) => [...text.matchAll(JS_IMPORT)].flatMap((m) => resolve(from, m[1]!) ?? []);
}

function pythonImports(files: Set<string>, index: Map<string, string | null>): Resolver {
  const find = (from: string, module: string): string | undefined => {
    const dots = module.length - module.replace(/^\.+/, '').length;
    const rest = module.slice(dots).replaceAll('.', '/');
    if (!dots) return index.get(rest) ?? undefined;
    let dir = posix.dirname(from);
    for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
    const stem = rest ? posix.join(dir, rest) : dir;
    return [`${stem}.py`, `${stem}/__init__.py`].find((c) => files.has(c));
  };
  return (from, text) => [
    ...[...text.matchAll(PY_FROM)].flatMap((m) => {
      const module = m[1]!;
      const names = (m[2] ?? m[3]!).split(',').flatMap((n) => n.trim().split(/\s+/)[0] || []);
      // `from pkg import sub` imports the submodule when one exists.
      const subs = names.flatMap((n) => find(from, `${module}${module.endsWith('.') ? '' : '.'}${n}`) ?? []);
      return subs.length ? subs : (find(from, module) ?? []);
    }),
    ...[...text.matchAll(PY_IMPORT)].flatMap((m) => m[1]!.split(',').flatMap((n) => find(from, n.trim()) ?? [])),
  ];
}

function luaImports(index: Map<string, string | null>): Resolver {
  return (_from, text) => [...text.matchAll(LUA_REQUIRE)].flatMap((m) => index.get(m[1]!.replaceAll('.', '/')) ?? []);
}

function fanInOf(texts: Map<string, string>): FanIn[] {
  const paths = [...texts.keys()];
  const files = new Set(paths);
  const resolvers: Record<Language, Resolver> = {
    js: jsImports(files),
    python: pythonImports(
      files,
      suffixIndex(
        paths.filter((p) => languageOf(p) === 'python'),
        '__init__',
      ),
    ),
    lua: luaImports(
      suffixIndex(
        paths.filter((p) => languageOf(p) === 'lua'),
        'init',
      ),
    ),
  };
  const importers = new Map<string, Set<string>>();
  for (const [from, text] of texts)
    for (const target of resolvers[languageOf(from)!](from, text))
      if (target !== from) importers.set(target, (importers.get(target) ?? new Set()).add(from));
  return [...importers]
    .map(([path, by]) => ({ path, importers: by.size }))
    .sort((a, b) => b.importers - a.importers || a.path.localeCompare(b.path));
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'constructor']);
/** Conversions, not forwarding: `return bool(x)` adds meaning. */
const BUILTINS = new Set([
  'bool',
  'int',
  'float',
  'str',
  'list',
  'dict',
  'set',
  'tuple',
  'len',
  'Boolean',
  'String',
  'Number',
]);

/**
 * A function whose whole body returns one call. Each pattern stops at the
 * call's opening parenthesis; `end` must match right after the closing one.
 */
const FORWARDS: Record<Language, { pattern: RegExp; end: RegExp }[]> = {
  js: [
    {
      // function name(a, b) { return target(a, b); }, and the same as a method
      pattern:
        /^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:(?:public|private|protected|static|async|override)[ \t]+)*(?:function[ \t]*\*?[ \t]*)?(?<name>[\w$]+)[ \t]*(?:<[^>\n]*>)?\((?<params>[^()]*)\)[ \t]*(?::[^{\n]+)?\{\s*return[ \t]+(?:await[ \t]+)?(?<callee>[\w$.]+)[ \t]*\(/gm,
      end: /^\s*;?\s*\}/,
    },
    {
      // const name = (a, b) => target(a, b);
      pattern:
        /^[ \t]*(?:export[ \t]+)?(?:const|let)[ \t]+(?<name>[\w$]+)[ \t]*(?::[^=\n]+)?=[ \t]*(?:async[ \t]*)?\((?<params>[^()]*)\)[ \t]*(?::[^=\n]+)?=>[ \t]*(?:await[ \t]+)?(?<callee>[\w$.]+)[ \t]*\(/gm,
      end: /^[ \t]*;?[ \t]*(?:\r?\n|$)/,
    },
  ],
  python: [
    {
      pattern:
        /^(?<indent>[ \t]*)(?:async[ \t]+)?def[ \t]+(?<name>\w+)[ \t]*\((?<params>[^()]*)\)[^:\n]*:[ \t]*\n(?:[ \t]*(?:"""(?:(?!""")[\s\S])*"""|'''(?:(?!''')[\s\S])*''')[ \t]*\n)?[ \t]+return[ \t]+(?:await[ \t]+)?(?<callee>[\w.]+)[ \t]*\(/gm,
      end: /^[ \t]*(?:#[^\n]*)?(?:\r?\n|$)/,
    },
  ],
  lua: [
    {
      pattern:
        /^[ \t]*(?:local[ \t]+)?function[ \t]+(?<name>[\w.:]+)[ \t]*\((?<params>[^()]*)\)\s*return[ \t]+(?<callee>[\w.:]+)[ \t]*\(/gm,
      end: /^\s*end\b/,
    },
  ],
};

/** The index just past the parenthesis that closes the one open before `from`, or -1. */
function closeParen(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** The names a parameter list binds, or none when it destructures. */
function parameterNames(params: string): string[] | undefined {
  if (/[{[]/.test(params)) return undefined;
  return params
    .split(',')
    .map((p) =>
      p
        .replace(/[:=].*$/s, '')
        .replace(/^[\s.*]+|[?\s]+$/g, '')
        .trim(),
    )
    .filter((p) => p && !['self', 'cls', 'this'].includes(p));
}

/** The arguments of a call split at its top-level commas, without spreads or keyword names. */
function argumentsOf(args: string): Set<string> {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= args.length; i++) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if ((c === ',' && depth === 0) || i === args.length) {
      parts.push(
        args
          .slice(start, i)
          .trim()
          .replace(/^(\.\.\.|\*\*?|\w+[ \t]*=(?!=)[ \t]*)/, ''),
      );
      start = i + 1;
    }
  }
  return new Set(parts);
}

/** Forwards when it takes parameters and hands each one, unchanged, to the call as a whole argument. */
function forwards(params: string, args: string): boolean {
  const names = parameterNames(params);
  const given = argumentsOf(args);
  return Boolean(names?.length) && names!.every((n) => given.has(n));
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/** A Python body is one statement when the next code line is back at the def's indent or less. */
function pythonBodyEnds(text: string, end: number, indent: string | undefined): boolean {
  if (indent === undefined) return true;
  const next = text.slice(end).match(/^[^\n]*\n(?:[ \t]*\n)*([ \t]*)\S/);
  return !next || next[1]!.length <= indent.length;
}

function passThroughsOf(path: string, text: string): PassThrough[] {
  const found: PassThrough[] = [];
  for (const { pattern, end } of FORWARDS[languageOf(path)!])
    for (const m of text.matchAll(pattern)) {
      const { name, params, callee, indent } = m.groups!;
      const open = m.index + m[0].length;
      const close = closeParen(text, open);
      if (close === -1 || KEYWORDS.has(name!) || BUILTINS.has(callee!) || callee!.startsWith('super')) continue;
      if (!end.test(text.slice(close, close + 200)) || !pythonBodyEnds(text, close, indent)) continue;
      if (!forwards(params!, text.slice(open, close - 1))) continue;
      const at = m.index + (m[0].match(/^\s*/)?.[0].length ?? 0);
      found.push({ path, line: lineAt(text, at), name: name!, callee: callee! });
    }
  return found;
}

const DECLARATION: Record<Language, RegExp> = {
  js: /^(?:export[ \t]+)?(?:default[ \t]+)?(?:declare[ \t]+)?(?:async[ \t]+)?(?:function\*?|class|const|let|var|type|interface|enum)[ \t]+([A-Za-z_$][\w$]*)/gm,
  python: /^(?:async[ \t]+)?(?:def|class)[ \t]+([A-Za-z_]\w*)/gm,
  lua: /^(?:local[ \t]+)?function[ \t]+(?:\w+[.:])*(\w+)/gm,
};
const TOKEN = /[A-Za-z_$][\w$]*/g;
/** Import statements name a symbol without using it, so they are not counted. */
const IMPORTS: Record<Language, RegExp | undefined> = {
  js: /^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*['"][^'"\n]+['"]/gm,
  python: /\b(?:from[ \t]+[.\w]+[ \t]+import|import)[ \t]+(?:\([^)]*\)|[^\n]*)/g,
  lua: undefined,
};

/** Top-level declarations in source files whose name appears exactly once more in all the code. */
function usedOnceOf(texts: Map<string, string>, isSource: (path: string) => boolean): UsedOnce[] {
  const declared: UsedOnce[] = [];
  for (const [path, text] of texts) {
    if (!isSource(path)) continue;
    for (const m of text.matchAll(DECLARATION[languageOf(path)!])) {
      const name = m[1]!;
      if (name.length > 2 && !name.startsWith('__') && name !== 'main') declared.push({ path, line: m.index, name });
    }
  }
  // Count only the declared names: most tokens are not one.
  const counts = new Map(declared.map((d) => [d.name, 0]));
  for (const [path, text] of texts) {
    const imports = IMPORTS[languageOf(path)!];
    for (const token of (imports ? text.replace(imports, '') : text).match(TOKEN) ?? []) {
      const count = counts.get(token);
      if (count !== undefined) counts.set(token, count + 1);
    }
  }
  return declared
    .filter((d) => counts.get(d.name) === 2)
    .map((d) => ({ ...d, line: lineAt(texts.get(d.path)!, d.line) }));
}

/** The pre-pass over every navigable file's text. */
export function navigationOf(texts: Map<string, string>, isSource: (path: string) => boolean): Navigation {
  return {
    fanIn: fanInOf(texts),
    passThroughs: [...texts].flatMap(([path, text]) => (isSource(path) ? passThroughsOf(path, text) : [])),
    usedOnce: usedOnceOf(texts, isSource),
  };
}
