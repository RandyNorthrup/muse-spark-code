import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ResourceTempRoot } from '../../../../src/core/resources/launch'
import type { ResourceHostSettings } from '../../../../src/core/resources/resourceGovernorEntry'
import type { ResourceAdmission, ResourceLaunchRequest } from '../../../../src/core/resources/queue'

/**
Suites that execute the production governed launcher against real OS
helpers, with no contention to queue for: admission grants at once. The
spawn itself (containment, tree stop, output bounds, deadlines) stays
production; only the queue wait is bypassed. Queueing itself is proved by
spawnBootstrap, spawnGovernance and spawnRuntimeAdmission, never here.
*/
function grantAtOnce(request: ResourceLaunchRequest): Promise<ResourceAdmission> {
  return Promise.resolve({
    ready: Promise.resolve({
      kind: request.kind,
      class: request.class,
      release: () => undefined,
    }),
    runNow: () => true,
    cancel: () => undefined,
  })
}

export function immediateAdmission(): (
  request: ResourceLaunchRequest,
) => Promise<ResourceAdmission> {
  return grantAtOnce
}

/**
Plain self-cleaning temp roots: the governor's proof-backed roots shell to
the native helper at its installed (built-layout) path, which a source
checkout running vitest does not have. Containment of the launched tree
stays production; root proofs are the registry suites' subject, never here.
*/
async function createPlainRoot(): Promise<ResourceTempRoot> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-immediate-roots-'))
  return {
    root,
    profile: path.join(root, 'profile'),
    cache: path.join(root, 'cache'),
    environment: {},
    finish: async () => {
      await rm(root, { recursive: true, force: true })
    },
  }
}

export function plainTempRoots(): ResourceHostSettings['tempRoots'] {
  return { create: createPlainRoot }
}

/**
Settings for suites that launch for real: the queue wait bypassed and
roots plain, everything else production.
*/
export function immediateResourceSettings(
  base: Omit<ResourceHostSettings, 'admission' | 'tempRoots'>,
): ResourceHostSettings {
  return { ...base, admission: immediateAdmission(), tempRoots: plainTempRoots() }
}
