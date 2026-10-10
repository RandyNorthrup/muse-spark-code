import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'

/**
 * A prepared helper changed after its self-test (SPAWN017C). The launch is
 * refused, the changed file is removed, and the next use re-prepares it.
 */
export class ResourceHelperChangedError extends Error {
  readonly code = 'helperChanged'

  constructor() {
    super('Prepared native helper changed after its self-test')
    this.name = 'ResourceHelperChangedError'
  }
}

/** Structural, not instanceof: the check and its callers live in different bundles. */
export function isResourceHelperChanged(error: unknown): error is ResourceHelperChangedError {
  return (
    error instanceof Error &&
    error.name === 'ResourceHelperChangedError' &&
    'code' in error &&
    error.code === 'helperChanged'
  )
}

/** Paths whose sealed bytes changed: their next preparation compiles, never reuses. */
const changedPaths = new Set<string>()

export function wasHelperChanged(file: string): boolean {
  return changedPaths.has(file)
}

async function digest(file: string): Promise<string | undefined> {
  try {
    return createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
  } catch {
    return undefined
  }
}

/** Never run again from this path: removed if possible, and recompiled next time. */
async function refuse(file: string): Promise<never> {
  changedPaths.add(file)
  try {
    await rm(file, { force: true })
  } catch {
    // A file that cannot be removed is still never run: its path recompiles next.
  }
  throw new ResourceHelperChangedError()
}

/**
 * Seals a helper around its self-test: its bytes are hashed before it runs and
 * must hash the same afterwards. `verify` hashes the file again before every
 * use. Size, times and file identity can be set by any same-user process, so
 * only the bytes count: equal bytes are the self-tested helper wherever they
 * live; changed or missing bytes are refused. The helper is a small file, read
 * once per launch.
 */
export async function sealHelper(
  file: string,
  selfTest: () => Promise<void>,
): Promise<() => Promise<void>> {
  const sealed = await digest(file)
  if (sealed === undefined) return await refuse(file)
  await selfTest()
  if ((await digest(file)) !== sealed) return await refuse(file)
  changedPaths.delete(file)
  return async () => {
    if ((await digest(file)) !== sealed) await refuse(file)
  }
}
