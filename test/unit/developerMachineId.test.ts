import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { DeveloperOptionsError } from '../../src/core/developer/developerOptions'
import { developerMachineIdFile, loadDeveloperMachineId } from '../../src/core/developer/machineId'

const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-machine-id-'))
  roots.push(root)
  return root
}

describe('loadDeveloperMachineId', () => {
  it('publishes an identity once and reads it back', async () => {
    const data = await freshRoot()
    const first = await loadDeveloperMachineId(data)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    await expect(loadDeveloperMachineId(data)).resolves.toBe(first)
  })

  it('refuses a data directory that cannot open, carrying the failure', async () => {
    const data = await freshRoot()
    const blocker = path.join(data, 'blocker')
    await writeFile(blocker, 'in the way', 'utf8')
    let failure: unknown
    try {
      await loadDeveloperMachineId(blocker)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DeveloperOptionsError)
    expect((failure as DeveloperOptionsError).code).toBe('unavailable')
    expect((failure as DeveloperOptionsError).message).toBe(UI_TEXT.developer.unavailable)
    expect((failure as DeveloperOptionsError).cause).toBeInstanceOf(Error)
  })

  it('loads a published identity instead of staging a new one', async () => {
    const data = await freshRoot()
    await mkdir(path.dirname(developerMachineIdFile(data)), { recursive: true })
    await writeFile(developerMachineIdFile(data), 'ab'.repeat(32), 'utf8')
    await expect(loadDeveloperMachineId(data)).resolves.toBe('ab'.repeat(32))
  })
})
