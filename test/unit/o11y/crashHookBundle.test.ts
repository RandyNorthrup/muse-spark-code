// dist/nodeCrashHook.js as the production build makes it (M111 lane OB;
// PLAN.md D6): the node CLI's loader, which installs the hook from the
// real chunk and degrades with the fixed unavailable word when the chunk
// is gone or malformed. The chunk is built the way scripts/build.mjs
// builds it and required the way the CLI requires it.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { O11Y_CRASH_HOOK_BUNDLE_FILE, UI_TEXT } from '../../../src/shared/constants'
import { installNodeCrashHook } from '../../../src/runtime/o11y/crashHook'
import {
  installNodeCrashHookBundle,
  isNodeCrashHookBundle,
} from '../../../src/runtime/o11y/crashHookBundle'
import { nodeTempRoot } from '../helpers/nodeNative'
import { recordCalls } from '../helpers/recordCalls'
import { FIXTURE_HOOK_TIMEOUT_MS } from '../helpers/fixtureBudget'

const built = { dir: '' }

beforeAll(async () => {
  built.dir = mkdtempSync(path.join(tmpdir(), 'muse-crash-hook-bundle-'))
  await build({
    entryPoints: [path.resolve('src/runtime/o11y/crashHookEntry.ts')],
    outfile: path.join(built.dir, O11Y_CRASH_HOOK_BUNDLE_FILE),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => {
  rmSync(built.dir, { recursive: true, force: true })
})

describe('node crash hook bundle', () => {
  it('loads the real chunk and installs the hook', async () => {
    const root = await nodeTempRoot('m111-ob-hookbundle-')
    try {
      const reported = recordCalls<[unknown]>()
      const uninstall = installNodeCrashHookBundle({
        distDir: built.dir,
        root,
        report: reported.fn,
      })
      expect(typeof uninstall).toBe('function')
      uninstall?.()
      expect(reported.calls).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('says the fixed word when the chunk is gone', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'muse-crash-hook-missing-'))
    try {
      const said: string[] = []
      const reported = recordCalls<[unknown]>()
      const uninstall = installNodeCrashHookBundle({
        distDir: empty,
        root: empty,
        report: reported.fn,
        print: (line) => {
          said.push(line)
        },
      })
      expect(uninstall).toBeUndefined()
      expect(said).toEqual([UI_TEXT.nodeErrors.unavailable])
      expect(reported.calls).toHaveLength(0)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('says the fixed word when the chunk is malformed', () => {
    const said: string[] = []
    const reported = recordCalls<[unknown]>()
    const uninstall = installNodeCrashHookBundle({
      distDir: built.dir,
      root: built.dir,
      report: reported.fn,
      loadBundle: () => ({ installNodeCrashHook: 'not a function' }),
      print: (line) => {
        said.push(line)
      },
    })
    expect(uninstall).toBeUndefined()
    expect(said).toEqual([UI_TEXT.nodeErrors.unavailable])
  })

  it('lets a load failure that is not a missing chunk keep its kind', () => {
    const failure = new TypeError('test load failure')
    const reported = recordCalls<[unknown]>()
    expect(() =>
      installNodeCrashHookBundle({
        distDir: built.dir,
        root: built.dir,
        report: reported.fn,
        loadBundle: () => {
          throw failure
        },
      }),
    ).toThrow(failure)
  })

  it('recognises the chunk shape and nothing else', () => {
    expect(isNodeCrashHookBundle({ installNodeCrashHook })).toBe(true)
    expect(isNodeCrashHookBundle({ installNodeCrashHook: 'no' })).toBe(false)
    expect(isNodeCrashHookBundle({})).toBe(false)
    expect(isNodeCrashHookBundle(null)).toBe(false)
  })

  it('writes the word to stderr without a print port', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'muse-crash-hook-stderr-'))
    const writes: string[] = []
    const savedStderr = { write: process.stderr.write }
    process.stderr.write = (chunk: unknown): boolean => {
      writes.push(String(chunk))
      return true
    }
    try {
      const reported = recordCalls<[unknown]>()
      const uninstall = installNodeCrashHookBundle({
        distDir: empty,
        root: empty,
        report: reported.fn,
      })
      expect(uninstall).toBeUndefined()
      expect(writes).toEqual([`${UI_TEXT.nodeErrors.unavailable}\n`])
    } finally {
      process.stderr.write = savedStderr.write
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('node crash hook entry', () => {
  it('exports the installer with no side effects on import', async () => {
    const entry = (await import('../../../src/runtime/o11y/crashHookEntry')) as {
      installNodeCrashHook: unknown
    }
    expect(typeof entry.installNodeCrashHook).toBe('function')
  })
})
