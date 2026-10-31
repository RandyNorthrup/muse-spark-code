import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { configureResources } from '../../../../src/core/resources/admission'
import { createdPathCommands } from '../../../../src/core/resources/resourceGovernorEntry'
import { runtimeWindowsJob } from '../../../../src/runtime/resources/jobs'
import { buildLinuxHelper } from '../../../../scripts/build-linux-helper.mjs'

/** The plan fields every created-registry child process is handed. */
export interface CreatedChildPlan {
  readonly manifest: string
  readonly base: string
  readonly storageDir: string
  readonly packageRoot: string
  readonly nativeRoot: string
}

/** Whether the plan carries the fields every created-registry child needs. */
export function isCreatedChildPlan(
  plan: Record<string, unknown>,
): plan is CreatedChildPlan & Record<string, unknown> {
  return (
    typeof plan['manifest'] === 'string' &&
    typeof plan['base'] === 'string' &&
    typeof plan['storageDir'] === 'string' &&
    typeof plan['packageRoot'] === 'string' &&
    typeof plan['nativeRoot'] === 'string'
  )
}

/**
A child process's created-registry wiring, as the product wires it: Linux's
helper answers files only; macOS and Windows answer directories through the
same commands. Admission is configured so the Windows job build is governed.
*/
export function createdChildSession(plan: CreatedChildPlan): {
  commands: (args: readonly string[]) => Promise<string>
  dispose: () => void
} {
  const windowsJob = runtimeWindowsJob(plan.storageDir, plan.packageRoot)
  const dispose = configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob,
  })
  const wired = createdPathCommands(plan.nativeRoot, windowsJob)
  return { commands: (args) => wired(args), dispose }
}

/** One bundled child entry plus the platform's own native helper build. */
export interface CreatedChildFixture {
  readonly folder: string
  readonly bundle: string
  readonly storage: string
  readonly nativeRoot: string
  dispose(): Promise<void>
}

/**
Bundle `entry` with esbuild and prepare the product's own native helpers,
so child processes run the confined native protocol the product ships,
never a copy of its flags: the Linux helper built here, the Windows job
assembly built here, the macOS helper `native/darwin/build.sh` builds.
*/
export async function createdChildFixture(
  folderPrefix: string,
  bundleName: string,
  entry: string,
  storagePrefix: string,
): Promise<CreatedChildFixture> {
  const folder = await mkdtemp(path.join(path.resolve('temp'), folderPrefix))
  const bundle = path.join(folder, bundleName)
  await build({
    entryPoints: [path.resolve(entry)],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  let storage = path.join(folder, 'jobs')
  let nativeRoot = path.resolve('native')
  let disposeAdmission: (() => void) | undefined
  if (process.platform === 'linux') {
    nativeRoot = path.join(folder, 'native')
    buildLinuxHelper(path.join(nativeRoot, 'linux', process.arch))
  } else if (process.platform === 'win32') {
    // The job helpers build where the Windows pipe helper suite builds them:
    // the temporary root, which the run's TEMP keeps private. The build is
    // admitted through the governor, configured as the host does.
    storage = await mkdtemp(path.join(tmpdir(), storagePrefix))
    const windowsJob = runtimeWindowsJob(storage, path.resolve('.'))
    disposeAdmission = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
  }
  return {
    folder,
    bundle,
    storage,
    nativeRoot,
    async dispose() {
      disposeAdmission?.()
      await rm(folder, { recursive: true, force: true })
      if (process.platform === 'win32') await rm(storage, { recursive: true, force: true })
    },
  }
}
