// Portable Node adapter shared by window and runtime. No VS Code dependency.
import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import path from 'node:path'
import { RESOURCE_PRIVATE_DIR_MODE, RESOURCE_TEMP_PREFIX } from '../../shared/constants'
import type { ResourceDiskSampler } from '../../core/resources/disk'
import type { CreatedRegistry } from '../../core/resources/createdRegistry'
import type { ResourceTempRoot, ResourceTempRoots } from '../../core/resources/launch'

export class TreeTempRoots implements ResourceTempRoots {
  constructor(
    private readonly parent: string,
    private readonly registry: CreatedRegistry,
    private readonly disks?: Pick<ResourceDiskSampler, 'assertWrite'>,
  ) {}

  async create(owner: string): Promise<ResourceTempRoot> {
    await this.disks?.assertWrite(this.parent)
    await mkdir(this.parent, { recursive: true, mode: RESOURCE_PRIVATE_DIR_MODE })
    const canonical = await realpath(this.parent)
    const root = await mkdtemp(path.join(canonical, RESOURCE_TEMP_PREFIX))
    // A registration failure is explicit; no blind deletion of an unregistered path.
    const recorded = await this.registry.recordCreated(root, owner, 'temp')
    const profile = path.join(root, 'browser-profile')
    const cache = path.join(root, 'browser-cache')
    await mkdir(profile, { mode: RESOURCE_PRIVATE_DIR_MODE })
    await mkdir(cache, { mode: RESOURCE_PRIVATE_DIR_MODE })
    return {
      root,
      profile,
      cache,
      environment: Object.freeze({ TMPDIR: root, TEMP: root, TMP: root }),
      finish: async (isFailed) => {
        await this.registry.finish(owner, isFailed)
        await this.registry.release(recorded)
      },
    }
  }
}
