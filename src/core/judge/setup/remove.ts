// M125 lane H (D107 §8.1): remove. Deletes only what setup added —
// the private runtime, its models, the lock and the registration —
// never a user's own Ollama, which lives outside these paths by
// construction. Missing paths report as missing, not as failures.
import { rm, stat } from 'node:fs/promises'
import { isErrno } from '../../fs/errno'

export interface JudgeInstallPaths {
  readonly runtimeRoot: string
  readonly modelsDir: string
  readonly lock: string
  readonly record: string
}

export interface RemoveResult {
  readonly removed: readonly string[]
  readonly missing: readonly string[]
}

/** Remove the private install; every path is setup-owned by type. */
export async function removeJudgeInstall(paths: JudgeInstallPaths): Promise<RemoveResult> {
  const removed: string[] = []
  const missing: string[] = []
  for (const candidate of [paths.runtimeRoot, paths.modelsDir, paths.lock, paths.record]) {
    try {
      await stat(candidate)
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      if (error.code !== 'ENOENT') throw error
      missing.push(candidate)
      continue
    }
    await rm(candidate, { recursive: true, force: true })
    removed.push(candidate)
  }
  return { removed, missing }
}
