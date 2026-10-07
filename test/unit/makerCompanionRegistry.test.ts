import { link, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as identity from '../../src/core/fs/fileIdentity'
import { makerCompanionPorts, registerMakerCompanion } from '../../src/core/maker/companionRegistry'
import { RUNTIME_MAKER_MAX_BYTES } from '../../src/shared/constants'

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  return { ...actual, tmpdir: vi.fn(actual.tmpdir), homedir: vi.fn(actual.homedir) }
})
const state = { root: '' }
beforeEach(async () => {
  const actual = await vi.importActual<typeof os>('node:os')
  state.root = await mkdtemp(path.join(actual.tmpdir(), 'maker-registry-'))
  vi.mocked(os.tmpdir).mockReturnValue(state.root)
  vi.mocked(os.homedir).mockReturnValue(path.join(state.root, 'home'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(os.tmpdir).mockReset()
  vi.mocked(os.homedir).mockReset()
  await rm(state.root, { recursive: true, force: true })
})
async function record(): Promise<string> {
  const directories = await readdir(state.root)
  const name = directories[0]
  if (name === undefined) throw new Error('registry')
  const directory = path.join(state.root, name)
  const files = await readdir(directory)
  const file = files[0]
  if (file === undefined) throw new Error('record')
  return path.join(directory, file)
}
describe('maker companion public-port registry', () => {
  it('keeps independent live records and removes only the closing instance', async () => {
    const first = await registerMakerCompanion([12_345])
    const second = await registerMakerCompanion([23_456])
    expect(await makerCompanionPorts()).toEqual(new Set([12_345, 23_456]))
    await first()
    expect(await makerCompanionPorts()).toEqual(new Set([23_456]))
    await second()
    expect(await makerCompanionPorts()).toEqual(new Set())
  })
  it('refuses hard-linked records before reading their content', async () => {
    await registerMakerCompanion([12_345])
    await link(await record(), path.join(state.root, 'private-fake-file'))
    await expect(makerCompanionPorts()).rejects.toThrow('maker-companion-registry-unavailable')
  })
  it('refuses a record replaced after open instead of reading another file through its name', async () => {
    await registerMakerCompanion([12_345])
    const target = await record()
    const readEntry = identity.lstatIdentity
    vi.spyOn(identity, 'lstatIdentity').mockImplementation(async (file) => {
      if (file === target) {
        await rename(file, path.join(state.root, 'held-record'))
        await writeFile(file, '{"ports":[23456]}')
      }
      return await readEntry(file)
    })
    await expect(makerCompanionPorts()).rejects.toThrow('maker-companion-registry-unavailable')
  })
  it('bounds record bytes even when excess text is valid JSON whitespace', async () => {
    await registerMakerCompanion([12_345])
    await writeFile(await record(), '{"ports":[12345]}' + ' '.repeat(RUNTIME_MAKER_MAX_BYTES))
    await expect(makerCompanionPorts()).rejects.toThrow('maker-companion-registry-unavailable')
  })
  it('validates the complete record shape before trusting its ports', async () => {
    await registerMakerCompanion([12_345])
    await writeFile(await record(), '{"ports":[12345],"approval":true}')
    await expect(makerCompanionPorts()).rejects.toThrow()
  })
})
