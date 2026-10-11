import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { parseCommandLine, type ServeOptions } from '../../src/runtime/cliArgs'
import { parseSharingArgs } from '../../src/runtime/sharing/args'
import { runtimeAcpSharing, runRuntimeSharing } from '../../src/runtime/sharing/sharingEntry'
import {
  defaultServeOptions,
  sharingPorts,
  type SharingPortsDeps,
  type SharingRuntime,
} from '../../src/runtime/sharing/sharingPorts'
import type { SessionHistoryOutcome } from '../../src/core/agent/agentBackend'
import type { Logger } from '../../src/host/logger'
import { EN } from '../../src/shared/l10n/en'
import { snapshotKindFixtures } from './helpers/sharingFixtures'

// The preview scrubs the OS user name on every renderPreview call
// (src/runtime/sharing/sharingEntry.ts calls userInfo() before the
// chat/prompt branch, so even read-free saved-prompt previews reach it),
// and rigs without a passwd entry throw ENOENT — pin a fixed identity.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  return {
    ...actual,
    userInfo: () => ({ username: 'tester', uid: 1, gid: 1, shell: null, homedir: '/tmp' }),
  }
})

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const silentLog: Logger = {
  trace: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

/** The live session's history, as the runtime backend's readSession returns it. */
const sessionHistory: SessionHistoryOutcome = {
  mode: 'snapshot',
  items: snapshotKindFixtures,
  name: 'Session title',
  todos: [],
}

/**
 * The production sharing ports with a fake backend standing in for
 * `runtimeFor`: `read` still runs main's real implementation (including the
 * `defaultServeOptions()` build), only the host behind it is faked.
 */
function productionPorts(seen?: { options?: ServeOptions }): {
  ports: ReturnType<typeof sharingPorts>
  deps: SharingPortsDeps
} {
  const deps: SharingPortsDeps = {
    createRuntime: (options) => {
      if (seen !== undefined) seen.options = options
      const runtime: SharingRuntime = {
        backend: {
          kind: 'museCode',
          hostFor: () =>
            Promise.resolve({
              readSession: () => Promise.resolve(sessionHistory),
            }),
        },
        close: () => Promise.resolve(),
      }
      return Promise.resolve(runtime)
    },
    credentialValues: [],
    readModelApiKey: () => Promise.resolve(undefined),
  }
  return { ports: sharingPorts(silentLog, undefined, deps), deps }
}

describe('share preview hotfix (0.17.1)', () => {
  it('parses every internal parseCommandLine call with literal argv', async () => {
    // main.ts self-executes on import, so the scan covers the process entry
    // (main.ts) and the extracted ports module it builds sharing from.
    const literals: RegExpExecArray[] = []
    for (const file of ['../../src/runtime/main.ts', '../../src/runtime/sharing/sharingPorts.ts']) {
      const source = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      const pattern = /parseCommandLine\(\[([^\]]*)\]\)/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) literals.push(match)
    }
    expect(literals.length).toBeGreaterThan(0)
    for (const [call, inner] of literals) {
      if (inner === undefined) throw new Error(`${call} has no captured argv`)
      const parsed: unknown = JSON.parse(`[${inner.replaceAll("'", '"')}]`)
      const argv: readonly string[] = z.array(z.string()).parse(parsed)
      expect(
        argv.every((entry) => typeof entry === 'string'),
        `${call} builds argv from string literals only`,
      ).toBe(true)
      // The strict parser treats a positional command word as unknown, so an
      // internal literal that parses to invalid breaks the caller's fallback
      // (0.17.0 passed ['serve'] and every share preview failed).
      expect(parseCommandLine(argv).command, `${call} must parse`).not.toBe('invalid')
    }
  })

  it('builds the sharing backend options from the empty-argv default', () => {
    const parsed = parseCommandLine([])
    expect(parsed.command).toBe('serve')
    if (parsed.command !== 'serve') throw new Error('the empty-argv default must stay serve')
    expect(defaultServeOptions()).toEqual(parsed.options)
  })

  it('renders the ACP /share chat preview for a session with history', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'share-preview-acp-')))
    roots.push(root)
    const { ports } = productionPorts()
    const shown = await runtimeAcpSharing(ports, EN, 'en').execute('/share chat', {
      cwd: root,
      sessionId: 's1',
      isActive: () => true,
      signal: new AbortController().signal,
    })
    expect(shown).toContain('Assistant text')
    expect(shown).not.toContain('did not return')
  })

  it('renders the CLI share of a chat target from the default serve options', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'share-preview-cli-')))
    roots.push(root)
    const seen: { options?: ServeOptions } = {}
    const { ports } = productionPorts(seen)
    const chunks: string[] = []
    const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      await runRuntimeSharing(
        parseSharingArgs(['share', 'chat', 's1', '--cwd', root]),
        ports,
        EN,
        'en',
      )
      expect(chunks.join('')).toContain('Assistant text')
      expect(chunks.join('')).not.toContain('did not return')
    } finally {
      output.mockRestore()
    }
    // The backend behind the preview was built from the documented
    // empty-argv default, the same options main.ts passes at runtime.
    const parsed = parseCommandLine([])
    if (parsed.command !== 'serve') throw new Error('the empty-argv default must stay serve')
    expect(seen.options).toEqual(parsed.options)
  })
})
