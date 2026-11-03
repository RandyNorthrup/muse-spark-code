// One tool write as a recorded turn's, through the production owner io and
// drained before it returns. Shared by the checkpoint legs of the M104g drivers.
import { randomUUID } from 'node:crypto'
import type { ToolIo } from '../../../src/core/backends/modelapi/tools'
import { canonicalPath } from '../../../src/host/canonicalPath'
import { createOwnerIo } from '../../../src/host/checkpoints/writeRecorder'

type OwnerWriteDeps = Pick<
  Parameters<typeof createOwnerIo>[1],
  'journal' | 'lanes' | 'owner' | 'workspaceRoot' | 'log'
>

export async function writeAsOwner(
  io: ToolIo,
  deps: OwnerWriteDeps,
  file: string,
  text: string,
): Promise<void> {
  const ownerIo = createOwnerIo(io, {
    ...deps,
    platform: process.platform,
    canonicalPath,
    newId: () => randomUUID(),
  })
  try {
    await ownerIo.writeFile(file, text, await canonicalPath(file), () => undefined)
  } finally {
    await ownerIo.drain()
  }
}
