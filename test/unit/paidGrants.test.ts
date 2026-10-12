// The ACP grant store's failure modes: a missing quote folder is no quotes,
// an unreadable one is reported with its kind, and a malformed record is
// ignored with its reason, never read as absent and never fatal.
import { mkdtempSync, rmSync } from 'node:fs'
import type * as Fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { paidGrantFile } from '../../src/runtime/paidGrants'

const folders: string[] = []
afterAll(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const denied = () => Object.assign(new Error('denied'), { code: 'EACCES' })
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof Fs>()
  return {
    ...actual,
    // The quote folder alone is unreadable; every other read stays real.
    readdirSync: () => {
      throw denied()
    },
  }
})

function logger() {
  return { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function grantsFile(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'paid-grants-'))
  folders.push(folder)
  return path.join(folder, 'paid-uses.json')
}

function fileStore(file: string, log = logger()) {
  const store = paidGrantFile({
    file,
    log,
    sleep: () => Promise.resolve(),
  })
  return { store, log }
}

const WORKSPACE = '/workspace/one'

describe('paid grant quote folder failures', () => {
  it('reads a missing quote folder as no quotes without a warning', () => {
    const { store, log } = fileStore(grantsFile())
    expect(store.read(WORKSPACE)).toEqual(new Set())
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('reports an unreadable quote folder with its kind while keeping the grant file', async () => {
    const { store, log } = fileStore(grantsFile())
    await store.add(WORKSPACE, ['webSearch'])
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0] ?? '')).toContain('(EACCES)')
    // The question it then asks carries the notice, so asking again is explained.
    expect(store.quoteNotice()).toEqual({ kind: 'EACCES' })
  })

  it('reads a malformed generation as no grant with its reason', async () => {
    const file = grantsFile()
    const { store, log } = fileStore(file)
    await mkdir(path.join(`${file}.d`, 'webSearch'), { recursive: true })
    await writeFile(path.join(`${file}.d`, 'webSearch', 'generation.json'), '{oops')
    expect(store.read(WORKSPACE)).toEqual(new Set())
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0] ?? '')).toContain('not valid JSON')
  })

  it('carries the syntax failure as the cause when a generation must be captured', async () => {
    const file = grantsFile()
    const { store } = fileStore(file)
    await mkdir(path.join(`${file}.d`, 'webSearch'), { recursive: true })
    await writeFile(path.join(`${file}.d`, 'webSearch', 'generation.json'), '{oops')
    let failure: unknown
    try {
      await store.prepareQuoteGeneration()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      cause: expect.objectContaining({ cause: expect.any(SyntaxError) }),
    })
  })
})
