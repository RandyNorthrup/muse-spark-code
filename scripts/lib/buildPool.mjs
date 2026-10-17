// Bounded async work pool for the production build (F6, msm112 cert,
// 2026-10-17). Starting every bundle at once (~90 concurrent builds through
// one esbuild service) failed under machine load with an error that named no
// file, then left the service wedged. This pool starts at most `size` tasks
// at a time, keys each result by its bundle name, and on failure names the
// bundle and stops starting new work so the caller can shut the service down
// and exit with the true error.

/**
 * @template T
 * @typedef {readonly [name: string, start: () => Promise<T>]} PoolSpec
 */

/**
 * @template T
 * @param {readonly PoolSpec<T>[]} specs
 * @param {number} size
 * @returns {Promise<Record<string, T>>}
 */
export async function runBuildPool(specs, size) {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error(`pool size must be a positive integer, got ${String(size)}`)
  }
  const seen = new Set()
  for (const [name] of specs) {
    if (seen.has(name)) throw new Error(`duplicate bundle name: ${name}`)
    seen.add(name)
  }
  const results = /** @type {Record<string, T>} */ ({})
  const queue = [...specs]
  let firstFailure
  async function worker() {
    while (firstFailure === undefined) {
      const next = queue.shift()
      if (next === undefined) return
      const [name, start] = next
      try {
        results[name] = await start()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        firstFailure ??= new Error(`bundle ${name} failed: ${message}`, { cause: error })
        return
      }
    }
  }
  const workers = []
  const count = Math.min(size, queue.length)
  for (let i = 0; i < count; i += 1) {
    workers.push(worker())
  }
  // Workers record the first failure instead of throwing, so this settles
  // every in-flight build before rejecting: the caller stops the esbuild
  // service on failure, so no build may still be in flight at that point.
  await Promise.all(workers)
  if (firstFailure !== undefined) throw firstFailure
  return results
}
