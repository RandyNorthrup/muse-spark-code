import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { NodePrivateFiles } from '../../../src/runtime/node/privateFiles'

// Native POSIX receipts; Windows exercises the explicit unsupported boundary.
// No native DACL/tools-process qualification is claimed by these tests.
export function nodeNativeTest(name: string, run: () => Promise<void>, timeoutMs?: number): void {
  const check = async (): Promise<void> => {
    if (process.platform !== 'win32') {
      await run()
      return
    }
    const root = await nodeTempRoot('m110-unsupported-')
    try {
      await expect(new NodePrivateFiles(root).prepare()).rejects.toThrow('not supported')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  if (timeoutMs === undefined) it(name, check)
  else it(name, { timeout: timeoutMs }, check)
}

export async function nodeTempRoot(prefix: string): Promise<string> {
  // macOS's system /var alias is resolved before creating a private root.
  const temporary = await realpath(tmpdir())
  return await mkdtemp(path.join(temporary, prefix))
}
