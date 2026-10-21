// The picked-file byte decoder behind the import dialog (M84): valid
// UTF-8 decoded, anything else refused in fixed words with its cause,
// through the real TextDecoder.

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { workspaceChildEnvironment } from '../../src/core/execGuard'
import { MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import {
  createToolIo,
  decodeText,
  decodeTransferBytes,
  runCommand,
  runResourceCommand,
} from '../../src/host/backend/toolIo'
import { removeFolder } from './helpers/temporaryFolders'

describe('decodeTransferBytes', () => {
  it('decodes valid UTF-8, dropping a byte-order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])
    expect(decodeTransferBytes(bytes)).toBe('{}')
  })

  it('refuses invalid UTF-8 in fixed words carrying the decoder failure', () => {
    // A lone continuation byte: the real TextDecoder with fatal on refuses it.
    let caught: unknown
    try {
      decodeTransferBytes(new Uint8Array([0x7b, 0x80, 0x7d]))
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const refused = caught as Error
    expect(refused.message).toBe(UI_TEXT.textFileInvalid)
    expect(refused.cause).toBeInstanceOf(TypeError)
  })
})

// The tool shell reads over real bytes and processes: binary is
// refused, a command that cannot start resolves unstarted, an admission
// revoked before the start settles into the result, and a checkpoint
// revoked before the start refuses the entry without starting anything.

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
      env: workspaceChildEnvironment(process.platform, process.env, {
        workspaceRoot: base,
        realpath: realpathSync,
      }),
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
