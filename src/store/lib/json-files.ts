import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Writes through a temp file and a rename, so a reader never sees half a file. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  // A name of its own, so two writes of one file at once never share a temp file.
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** Every `*.json` in a folder, oldest id first. */
export async function readJsonFolder<T>(dir: string): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const items = await Promise.all(names.map((name) => readJson<T>(join(dir, name))));
  return items.filter((item): item is Awaited<T> => item !== undefined) as T[];
}
