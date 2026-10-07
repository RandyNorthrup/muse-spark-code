// Portable Node adapter shared by window and runtime. No VS Code dependency.
import path from 'node:path'
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
    if (this.parent !== this.registry.base) throw new Error('Temp root base mismatch')
    const { id: recorded, root } = await this.registry.createTemp(owner)
    const profile = path.join(root, 'browser-profile')
    const cache = path.join(root, 'browser-cache')
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
