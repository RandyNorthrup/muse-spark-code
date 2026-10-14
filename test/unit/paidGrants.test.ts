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
import { testPaidLogger } from './helpers/paidGrants'
import { quotedSearch } from './helpers/paidQuote'

const folders: string[] = []
afterAll(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const denied = () => Object.assign(new Error('denied'), { code: 'EACCES' })
// What the quote-folder listing does: denied always, or missing (ENOENT) so
// the missing-folder branch runs instead of being short-circuited (P3-6).
const readdirBehavior = vi.hoisted(() => ({ mode: 'denied' }))
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof Fs>()
  return {
    ...actual,
    // The quote folder alone is unreadable; every other read stays real.
    readdirSync: () => {
      if (readdirBehavior.mode === 'missing') {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      throw denied()
    },
  }
})

function grantsFile(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'paid-grants-'))
  folders.push(folder)
  return path.join(folder, 'paid-uses.json')
}

function fileStore(file: string, log = testPaidLogger()) {
  const store = paidGrantFile({
    file,
    log,
    sleep: () => Promise.resolve(),
  })
  return { store, log }
}

const WORKSPACE = '/workspace/one'

describe('paid grant quote folder failures', () => {
  it('reads a missing quote folder as no quotes without a warning (P3-6)', async () => {
    // The generation exists, so read() reaches the folder listing: the old
    // test never ran the ENOENT branch it named.
    readdirBehavior.mode = 'missing'
    try {
      const { store, log } = fileStore(grantsFile())
      await store.add(WORKSPACE, ['webSearch'])
      expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
      expect(log.warn).not.toHaveBeenCalled()
      expect(store.quoteNotice?.()).toBeUndefined()
    } finally {
      readdirBehavior.mode = 'denied'
    }
  })

  it('reports an unreadable quote folder with its kind while keeping the grant file', async () => {
    const { store, log } = fileStore(grantsFile())
    await store.add(WORKSPACE, ['webSearch'])
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0] ?? '')).toContain('(EACCES)')
    // The question it then asks carries the notice, so asking again is explained.
    expect(store.quoteNotice?.()).toEqual({ kind: 'denied' })
  })

  it('warns about an unreadable quote folder once, not on every read (P3-3)', async () => {
    const { store, log } = fileStore(grantsFile())
    await store.add(WORKSPACE, ['webSearch'])
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(log.warn).toHaveBeenCalledOnce()
    // The notice still reaches the next question every time.
    expect(store.quoteNotice?.()).toEqual({ kind: 'denied' })
  })

  it('drops a stale quote notice when no generation exists (P3-3)', async () => {
    const file = grantsFile()
    const { store } = fileStore(file)
    await store.add(WORKSPACE, ['webSearch'])
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(store.quoteNotice?.()).toEqual({ kind: 'denied' })
    // The generation goes missing: no quotes exist, so no unreadable-quotes
    // notice survives to claim saved choices are unreadable.
    rmSync(path.join(`${file}.d`, 'webSearch', 'generation.json'), { force: true })
    expect(store.readQuote?.(WORKSPACE, quotedSearch('5').quote)).toBeUndefined()
    expect(store.quoteNotice?.()).toBeUndefined()
  })

  it('drops a stale quote notice when the folder becomes missing (P3-3)', async () => {
    const { store } = fileStore(grantsFile())
    await store.add(WORKSPACE, ['webSearch'])
    expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
    expect(store.quoteNotice?.()).toEqual({ kind: 'denied' })
    // The folder is gone now: a missing folder is no quotes, so the notice
    // must not survive to claim saved choices are unreadable.
    readdirBehavior.mode = 'missing'
    try {
      expect(store.read(WORKSPACE)).toEqual(new Set(['webSearch']))
      expect(store.quoteNotice?.()).toBeUndefined()
    } finally {
      readdirBehavior.mode = 'denied'
    }
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
    const prepare = store.prepareQuoteGeneration
    expect(prepare).toBeDefined()
    let failure: unknown
    try {
      await prepare?.()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      cause: expect.objectContaining({ cause: expect.any(SyntaxError) }),
    })
  })
})
