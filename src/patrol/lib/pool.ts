/** Runs `tasks` with at most `limit` running at once, and returns their results in order. */
export async function inPool<T>(limit: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < tasks.length; index = next++) results[index] = await tasks[index]!();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
