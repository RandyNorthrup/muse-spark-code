import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { paidGrantFile } from '../../../src/runtime/paidGrants'
import { workspaceKey } from '../../../src/runtime/dataFolder'
import * as atomic from '../../../src/host/fsAtomic'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
async function setup() {
  const directory = await fixtures.folder('m104-pb-grants-')
  const file = path.join(directory, 'grants.json')
  const grants = paidGrantFile({
    file,
    log: new FakeLogOutputChannel(),
    sleep: () => Promise.resolve(),
  })
  return { grants, file }
}
describe('contract v2 workspace paid revocation', () => {
  it('revokes only this workspace and permits a fresh explicit grant', async () => {
    const { grants } = await setup()
    await grants.add('/one', ['webSearch'])
    await grants.add('/two', ['webSearch'])
    await grants.forgetWorkspace('/one')
    expect(grants.read('/one').size).toBe(0)
    expect(grants.read('/two').has('webSearch')).toBe(true)
    await grants.add('/one', ['webSearch'])
    expect(grants.read('/one').has('webSearch')).toBe(true)
    await grants.forget(['webSearch'])
    expect(grants.read('/one').size).toBe(0)
    expect(grants.read('/two').size).toBe(0)
  })
  it('cannot resurrect a grant whose writer was admitted before workspace revocation', async () => {
    const { grants } = await setup()
    await grants.add('/one', ['voice'])
    const gate = Promise.withResolvers<undefined>()
    const write = atomic.writeFileAtomically
    const started = Promise.withResolvers<undefined>()
    const spy = vi
      .spyOn(atomic, 'writeFileAtomically')
      .mockImplementation(async (file, text, options) => {
        if (
          file.endsWith('.json') &&
          !file.endsWith('generation.json') &&
          file.includes(`${workspaceKey('/one')}.`)
        ) {
          started.resolve(undefined)
          await gate.promise
        }
        await write(file, text, options)
      })
    try {
      const adding = grants.add('/one', ['voice'])
      await started.promise
      await grants.forgetWorkspace('/one')
      gate.resolve(undefined)
      await adding
      expect(grants.read('/one').has('voice')).toBe(false)
    } finally {
      gate.resolve(undefined)
      spy.mockRestore()
    }
  })
  it('refuses a damaged workspace revocation record instead of falling back to a legacy grant', async () => {
    const { grants, file } = await setup()
    await grants.add('/one', ['voice'])
    await writeFile(
      path.join(`${file}.d`, 'voice', `${workspaceKey('/one')}.generation.json`),
      '{}',
    )
    expect(() => grants.read('/one')).toThrow('could not be read')
    await expect(grants.add('/one', ['voice'])).rejects.toThrow('could not be read')
  })
})
