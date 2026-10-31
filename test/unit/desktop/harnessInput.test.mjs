import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  VIRTUAL_INPUT_BUILD_HINT,
  findVirtualInputBinary,
  runVirtualInputScript,
} from '../../../test/desktop/harness/lib/virtualInput.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('virtual-input driver discovery', () => {
  it('honours an explicit MUSE_VIRTUAL_INPUT override', async () => {
    const found = await findVirtualInputBinary({
      repoRoot: root,
      env: { ...process.env, MUSE_VIRTUAL_INPUT: process.execPath },
    })
    expect(found).toBe(path.resolve(process.execPath))
  })

  it('refuses to run a script when the driver is not built', async () => {
    await expect(
      runVirtualInputScript(undefined, { env: process.env, script: 'key a tap\n' }),
    ).rejects.toThrow(VIRTUAL_INPUT_BUILD_HINT)
  })
})
