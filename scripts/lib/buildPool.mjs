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
  const results = /** @type {Record<string, T>} */ ({})
  const queue = [...specs]
  let hasFailed = false
  async function worker() {
    while (!hasFailed) {
      const next = queue.shift()
      if (next === undefined) return
      const [name, start] = next
      try {
        results[name] = await start()
      } catch (error) {
        hasFailed = true
        throw new Error(`bundle ${name} failed: ${error.message}`, { cause: error })
      }
    }
  }
  const workers = []
  const count = Math.min(Math.max(1, Math.floor(size)), queue.length)
  for (let i = 0; i < count; i += 1) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}
