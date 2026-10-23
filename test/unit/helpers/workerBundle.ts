// One esbuild worker bundle per suite, built once and removed afterwards.
// Suites share it instead of repeating the scratch fixture, so the
// duplication gate stays silent and every bundle still cleans up the same
// way.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

export interface WorkerBundle {
  /** The scratch folder; the suite's lock and store dirs live under it. */
  readonly folder: string
  /** The built bundle the drivers require. */
  readonly bundle: string
  cleanup(): Promise<void>
}

/** Build one worker bundle under a fresh worktree-temp scratch folder. */
export async function bundleWorker(
  entry: string,
  prefix: string,
  outName: string,
): Promise<WorkerBundle> {
  const temp = path.resolve('temp')
  await mkdir(temp, { recursive: true })
  const folder = await mkdtemp(path.join(temp, prefix))
  const bundle = path.join(folder, outName)
  await build({
    entryPoints: [path.resolve(entry)],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return {
    folder,
    bundle,
    cleanup: async () => {
      await rm(folder, { recursive: true, force: true })
    },
  }
}
