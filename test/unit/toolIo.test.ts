// The tool shell reads over real bytes and processes: binary is
// refused, a command that cannot start resolves unstarted, an admission
// revoked before the start settles into the result, and a checkpoint
// revoked before the start refuses the entry without starting anything.

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MODEL_TEXT } from '../../src/shared/constants'
import {
  createToolIo,
  decodeText,
  runCommand,
  runResourceCommand,
} from '../../src/host/backend/toolIo'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-tool-io-')))
afterAll(async () => {
  await removeFolder(base)
})

describe('decodeText', () => {
  it('decodes text and refuses binary and malformed bytes', () => {
    expect(decodeText(new TextEncoder().encode('words'), '/some/file.txt')).toBe('words')
    expect(() => decodeText(new Uint8Array([0x41, 0x00]), '/some/file.bin')).toThrow(
      MODEL_TEXT.fileNotText,
    )
    expect(() => decodeText(new Uint8Array([0xff, 0xfe]), '/some/file.txt')).toThrow(
      MODEL_TEXT.fileNotText,
    )
  })
})

describe('runCommand', () => {
  it('resolves unstarted when the file cannot be started', async () => {
    const logged: string[] = []
    const result = await runCommand({
      file: '/muse-spark-test-no-such-binary',
      args: [],
      cwd: base,
      env: process.env,
      timeoutMs: 5000,
      signal: undefined,
      tree: {
        platform: process.platform,
        systemRoot: undefined,
        log: (message: string) => {
          logged.push(message)
        },
      },
    })
    expect(result.exitCode).toBeNull()
    expect(result.isWorkspaceShutdownProven).toBe(true)
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})

describe('runResourceCommand', () => {
  it('settles a revoked admission into the command result', async () => {
    const result = await runResourceCommand(
      { command: 'echo', args: ['hi'] },
      5000,
      base,
      process.env,
      undefined,
      () => {
        throw new Error('admission revoked')
      },
    )
    expect(result.exitCode).toBe(-1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('admission revoked')
  })
})

describe('runShell', () => {
  it('refuses the entry when the checkpoint is revoked before the start', async () => {
    const logged: string[] = []
    const io = createToolIo({
      platform: process.platform,
      listFiles: () => Promise.resolve([]),
      systemRoot: undefined,
      env: () => process.env,
      searchWorkerPath: '',
      log: (message: string) => {
        logged.push(message)
      },
      unsavedFiles: () => [],
    })
    const result = await io.runShell('echo hi', base, 5000, undefined, undefined, () => {
      throw new Error('checkpoint revoked')
    })
    expect(result.isEntryRefused).toBe(true)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})
