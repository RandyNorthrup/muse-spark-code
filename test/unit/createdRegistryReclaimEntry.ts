// The creating process of the created-registry reclaim proof, bundled with
// esbuild by test/unit/createdRegistryReclaim.test.ts and driven by
// test/hosts/created-registry-reclaim-worker.mjs. The real CreatedRegistry
// on the shared manifest with the product's own native file commands and
// the product's own process-owner proof: this process is the creator its
// entries name. Knip does not trace the esbuild bundle, so this file is a
// declared entry in knip.jsonc.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { createdPathCommands } from '../../src/core/resources/resourceGovernorEntry'
import { configureResources } from '../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { createdCreator, createdRegistryProof } from './helpers/resources/registryProof'

interface ReclaimPlan {
  readonly manifest: string
  readonly base: string
  readonly storageDir: string
  readonly packageRoot: string
  readonly nativeRoot: string
  readonly owner: string
  readonly action: 'hold' | 'exit' | 'finish'
}

function isReclaimPlan(value: unknown): value is ReclaimPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  return (
    typeof plan['manifest'] === 'string' &&
    typeof plan['base'] === 'string' &&
    typeof plan['storageDir'] === 'string' &&
    typeof plan['packageRoot'] === 'string' &&
    typeof plan['nativeRoot'] === 'string' &&
    typeof plan['owner'] === 'string' &&
    ['hold', 'exit', 'finish'].includes(plan['action'] as string)
  )
}

/**
Create one temp tree with a payload file in it, print its identity as one
JSON line, then hold (the parent kills this process), exit, or finish the
owner as failed first (the launch host's own end-of-work call).
*/
export async function runCreator(planJson: string): Promise<void> {
  const plan: unknown = JSON.parse(planJson)
  if (!isReclaimPlan(plan)) throw new Error('the reclaim plan did not parse')
  const windowsJob = runtimeWindowsJob(plan.storageDir, plan.packageRoot)
  const disposeAdmission = configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob,
  })
  try {
    const commands = createdPathCommands(plan.nativeRoot, windowsJob)
    // finish() asks the proof whether the owner retired: the launch host
    // answers from its retired set while it finishes a tree, and this
    // process is that host for its own owner at that one moment.
    const finishing = { value: false }
    const proof = {
      ...createdRegistryProof((args) => commands(args)),
      exited: (owner: string) => Promise.resolve(finishing.value && owner === plan.owner),
    }
    const registry = await CreatedRegistry.open(plan.manifest, Date.now, proof, plan.base)
    const tree = await registry.createTemp(plan.owner)
    await writeFile(path.join(tree.root, 'payload.txt'), 'work in progress\n')
    if (plan.action === 'finish') {
      finishing.value = true
      await registry.finish(plan.owner, true)
    }
    process.stdout.write(
      `${JSON.stringify({ id: tree.id, root: tree.root, pid: process.pid, creator: await createdCreator() })}\n`,
    )
    if (plan.action === 'hold') {
      // Killed by the parent with SIGKILL: no finish, no cleanup, as a
      // crashed or killed host leaves its tree.
      await new Promise<never>(() => {
        setInterval(() => undefined, 60_000)
      })
    }
  } finally {
    disposeAdmission()
  }
}
