import { link, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makerCompanionPorts, registerMakerCompanion } from '../../src/core/maker/companionRegistry'
import { RUNTIME_MAKER_MAX_BYTES } from '../../src/shared/constants'

const state = { root: '' }
const environmentKeys = ['TMPDIR', 'TMP', 'TEMP', 'HOME', 'USERPROFILE'] as const
const savedEnvironment = new Map<string, string | undefined>()
beforeEach(async () => {
  // node:os answers tmpdir() and homedir() from these variables on every
  // platform it supports, so the real registry code works inside the fixture.
  for (const key of environmentKeys) savedEnvironment.set(key, process.env[key])
  state.root = await mkdtemp(path.join(tmpdir(), 'maker-registry-'))
  for (const key of ['TMPDIR', 'TMP', 'TEMP'] as const) process.env[key] = state.root
  process.env['HOME'] = path.join(state.root, 'home')
  process.env['USERPROFILE'] = path.join(state.root, 'home')
})
afterEach(async () => {
  for (const key of environmentKeys) {
    const saved = savedEnvironment.get(key)
    if (saved === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = saved
  }
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
