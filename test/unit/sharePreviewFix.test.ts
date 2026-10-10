import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseSharingArgs } from '../../src/runtime/sharing/args'
import {
  runtimeAcpSharing,
  runRuntimeSharing,
  type RuntimeSharingPorts,
} from '../../src/runtime/sharing/sharingEntry'
import { EN } from '../../src/shared/l10n/en'
import { snapshotKindFixtures } from './helpers/sharingFixtures'

// The preview scrubs the OS user name; sandboxed rigs may have no passwd
// entry, so pin it instead of reading the machine.
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

/** Ports whose read returns the live session's history, as the runtime's read does. */
function historyPorts(root: string): RuntimeSharingPorts {
  return {
    folders: {
      platform: process.platform,
      homeDir: root,
      env: { XDG_DATA_HOME: root, LOCALAPPDATA: root },
    },
    read: (_cwd, sessionId, exportedAt) =>
      Promise.resolve({
        sessionId,
        title: 'Session title',
        exportedAt,
        items: snapshotKindFixtures,
      }),
  }
}

describe('share preview hotfix (0.17.1)', () => {
  it('parses every internal parseCommandLine call with literal argv', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../src/runtime/main.ts', import.meta.url)),
      'utf8',
    )
    const pattern = /parseCommandLine\(\[([^\]]*)\]\)/g
    const literals: RegExpExecArray[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) literals.push(match)
    expect(literals.length).toBeGreaterThan(0)
    for (const [call, inner] of literals) {
      if (inner === undefined) throw new Error(`${call} has no captured argv`)
      const argv: readonly string[] =
        inner.trim() === '' ? [] : (JSON.parse(`[${inner.replaceAll("'", '"')}]`) as string[])
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

  it('renders the ACP /share chat preview for a session with history', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'share-preview-acp-')))
    roots.push(root)
    const shown = await runtimeAcpSharing(historyPorts(root), EN, 'en').execute('/share chat', {
      cwd: root,
      sessionId: 's1',
      isActive: () => true,
      signal: new AbortController().signal,
    })
    expect(shown).toContain('Assistant text')
    expect(shown).not.toContain('did not return')
  })

  it('renders the CLI share of a chat target', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'share-preview-cli-')))
    roots.push(root)
    const chunks: string[] = []
    const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      await runRuntimeSharing(
        parseSharingArgs(['share', 'chat', 's1', '--cwd', root]),
        historyPorts(root),
        EN,
        'en',
      )
      expect(chunks.join('')).toContain('Assistant text')
      expect(chunks.join('')).not.toContain('did not return')
    } finally {
      output.mockRestore()
    }
  })
})
