// One worker of the created-registry race, bundled with esbuild by
// test/unit/createdRegistryRace.test.ts and driven by
// test/hosts/created-registry-race.mjs through
// test/hosts/created-registry-race-worker.mjs. The real CreatedRegistry on
// the shared manifest file with the product's own native file commands on
// every platform (createdPathCommands): the Linux helper the test builds,
// the Windows job assembly the test builds into the shared storage folder,
// the macOS helper the CI builds before the unit step. Knip does not trace
// the esbuild bundle, so this file is a declared entry in knip.jsonc.
import { setTimeout as delay } from 'node:timers/promises'
import { CreatedRegistry, type CreatedPathProof } from '../../src/core/resources/createdRegistry'
import { createdPathCommands } from '../../src/core/resources/resourceGovernorEntry'
import { configureResources } from '../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'

interface RacePlan {
  readonly manifest: string
  readonly base: string
  readonly storageDir: string
  readonly packageRoot: string
  readonly nativeRoot: string
  readonly rounds: number
  readonly creates: number
  readonly startAt: number
  readonly gapMs: number
  readonly worker: number
}

function isRacePlan(value: unknown): value is RacePlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  return (
    typeof plan['manifest'] === 'string' &&
    typeof plan['base'] === 'string' &&
    typeof plan['storageDir'] === 'string' &&
    typeof plan['packageRoot'] === 'string' &&
    typeof plan['nativeRoot'] === 'string' &&
    typeof plan['rounds'] === 'number' &&
    typeof plan['creates'] === 'number' &&
    typeof plan['startAt'] === 'number' &&
    typeof plan['gapMs'] === 'number' &&
    typeof plan['worker'] === 'number'
  )
}

/**
Build the Windows job helpers into the storage folder, so a hand run of the
driver reuses one build the way the test does. Returns the assembly path.
*/
export async function buildJobs(storageDir: string, packageRoot: string): Promise<string> {
  const windowsJob = runtimeWindowsJob(storageDir, packageRoot)
  const disposeAdmission = configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob,
  })
  try {
    const jobs = await windowsJob()
    if (jobs === undefined) throw new Error('the Windows job helpers did not build')
    return jobs.assemblyPath
  } finally {
    disposeAdmission()
  }
}

/** This worker's creates and failures as one JSON line. Never throws. */
export async function runWorker(planJson: string): Promise<string> {
  const created: string[] = []
  const failures: string[] = []
  try {
    const plan: unknown = JSON.parse(planJson)
    if (!isRacePlan(plan)) throw new Error('the race plan did not parse')
    // As the product wires it: Linux's helper answers files only; macOS and
    // Windows answer directories through the same commands.
    const windowsJob = runtimeWindowsJob(plan.storageDir, plan.packageRoot)
    const disposeAdmission = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    try {
      const commands = createdPathCommands(plan.nativeRoot, windowsJob)
      const files = (args: readonly string[]): Promise<string> => commands(args)
      const proof: CreatedPathProof = {
        files,
        directories: process.platform === 'linux' ? undefined : files,
        exited: () => Promise.resolve(false),
        createdByTree: () => Promise.resolve(false),
        archivedAndClean: () => Promise.reject(new Error('Archive/clean proof is not installed')),
        freeBytes: () => Promise.resolve(null),
      }
      const registry = await CreatedRegistry.open(plan.manifest, Date.now, proof, plan.base)
      for (let round = 0; round < plan.rounds; round += 1) {
        const wait = plan.startAt + round * plan.gapMs - Date.now()
        if (wait > 0) await delay(wait)
        for (let create = 0; create < plan.creates; create += 1) {
          try {
            const { id } = await registry.createTemp(`race-${String(plan.worker)}`)
            created.push(id)
          } catch (error: unknown) {
            failures.push(
              error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            )
          }
        }
      }
    } finally {
      disposeAdmission()
    }
  } catch (error: unknown) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  }
  return `${JSON.stringify({ created, failures })}\n`
}
