// D119 catch burn-down: runtime handlers name their expected failure and
// rethrow the rest. Every test drives the real code into its real failure:
// a missing file, a refused permission, a vanished listing entry, malformed
// arguments, a corrupt store, a failing key read.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { parseAccountsCommand } from '../../src/runtime/providers/accountArgs'
import {
  createQuestionQueueStore,
  createQuestionStore,
} from '../../src/runtime/questions/questionStore'
import { sharingPorts, type SharingRuntime } from '../../src/runtime/sharing/sharingPorts'
import {
  isResetReadError,
  readResourceReset,
  writeResourceReset,
} from '../../src/runtime/usage/resourceResetFile'
import { RESOURCE_JOURNAL_RESET_FILE } from '../../src/shared/constants'

const folders: string[] = []
afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'runtime-catch-'))
  folders.push(dir)
  return dir
}

const isPosix = process.platform !== 'win32'

describe('readResourceReset', () => {
  it('reads -1 without a boundary file', () => {
    expect(readResourceReset(path.join(folder(), 'nowhere'))).toBe(-1)
  })

  it('fails closed on a corrupt boundary', () => {
    const dir = folder()
    writeFileSync(path.join(dir, RESOURCE_JOURNAL_RESET_FILE), '{oops', 'utf8')
    expect(readResourceReset(dir)).toBe(Infinity)
  })

  it('reads a written boundary', async () => {
    const dir = folder()
    await writeResourceReset(dir, 42)
    expect(readResourceReset(dir)).toBe(42)
  })

  it.runIf(isPosix)('fails closed on a refused boundary read', () => {
    const dir = folder()
    const file = path.join(dir, RESOURCE_JOURNAL_RESET_FILE)
    writeFileSync(file, '{"v":1,"resetAtMs":7}', 'utf8')
    chmodSync(file, 0o000)
    expect(readResourceReset(dir)).toBe(Infinity)
  })

  it('classifies only unreadable and corrupt boundaries as covered', () => {
    expect(isResetReadError(new SyntaxError('bad json'))).toBe(true)
    expect(isResetReadError(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(true)
    expect(isResetReadError(Object.assign(new Error('busy'), { code: 'EBUSY' }))).toBe(false)
    expect(isResetReadError(new Error('plain'))).toBe(false)
  })
})

describe('question store loads', () => {
  it('reads empty without a store file', async () => {
    const store = createQuestionStore(folder())
    await expect(store.load('s1')).resolves.toEqual([])
  })

  it('refuses a corrupt store in fixed words without quoting its text', async () => {
    const dir = folder()
    writeFileSync(
      path.join(dir, 's1.json'),
      '{"version":1,"snapshot":{"sessionId":"s1","questions":"SECRET-QUESTION-TEXT',
      'utf8',
    )
    const store = createQuestionStore(dir)
    try {
      await store.load('s1')
      expect.unreachable('a corrupt store must refuse the load')
    } catch (error) {
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain('could not be sent')
      expect(error.message).not.toContain('SECRET-QUESTION-TEXT')
    }
  })

  it.runIf(isPosix)('lets a refused store read keep its kind', async () => {
    const dir = folder()
    writeFileSync(path.join(dir, 's1.json'), '{"version":1}', 'utf8')
    chmodSync(path.join(dir, 's1.json'), 0o000)
    const store = createQuestionStore(dir)
    await expect(store.load('s1')).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('round-trips a saved queue', async () => {
    const store = createQuestionQueueStore(folder())
    const messages = [{ sessionId: 's1', userInputId: 'u1', text: 'hello' }]
    await store.save('s1', messages)
    await expect(store.load('s1')).resolves.toEqual(messages)
  })
})

describe('parseAccountsCommand boundary input', () => {
  it('reads no command for an unknown option', () => {
    expect(parseAccountsCommand(['list', '--provider', 'meta', '--bogus', 'x'])).toBeUndefined()
  })

  it('reads no command for malformed thresholds JSON', () => {
    expect(
      parseAccountsCommand([
        'thresholds',
        '--provider',
        'meta',
        '--account',
        'work',
        '--thresholds',
        '{oops',
      ]),
    ).toBeUndefined()
  })

  it('reads no command for a malformed provider id', () => {
    expect(parseAccountsCommand(['list', '--provider', 'META!'])).toBeUndefined()
  })

  it('keeps reading a well-formed command', () => {
    expect(parseAccountsCommand(['list', '--provider', 'meta'])).toEqual({
      action: 'list',
      provider: 'meta',
    })
  })
})

function logger(): { log: Logger; messages: string[] } {
  const messages: string[] = []
  const push = (message: string): void => {
    messages.push(message)
  }
  return {
    messages,
    log: { trace: push, info: push, warn: push, error: push },
  }
}

function modelApiRuntime(): SharingRuntime {
  return {
    backend: {
      kind: 'modelApi',
      hostFor: () => Promise.reject(new Error('unused in this path')),
    },
    close: () => Promise.resolve(),
  }
}

describe('sharing registered secrets', () => {
  it('refuses the share in fixed words with the failed key read as cause', async () => {
    const { log, messages } = logger()
    const ports = sharingPorts(log, modelApiRuntime(), {
      createRuntime: () => Promise.reject(new Error('unused in this path')),
      credentialValues: ['cred-a'],
      readModelApiKey: () => readFile(path.join(folder(), 'nowhere', 'key'), 'utf8'),
    })
    try {
      await ports.registeredSecrets()
      expect.unreachable('a failed key read must refuse the share')
    } catch (error) {
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain('expired')
      expect(error.cause).toMatchObject({ code: 'ENOENT' })
    }
    expect(messages).toEqual([])
  })

  it('returns the taken credentials without a key read off the Model API backend', async () => {
    const { log } = logger()
    const ports = sharingPorts(
      log,
      {
        backend: {
          kind: 'museCode',
          hostFor: () => Promise.reject(new Error('unused in this path')),
        },
        close: () => Promise.resolve(),
      },
      {
        createRuntime: () => Promise.reject(new Error('unused in this path')),
        credentialValues: ['cred-a'],
        readModelApiKey: () => {
          throw new Error('must not read a key off this backend')
        },
      },
    )
    await expect(ports.registeredSecrets()).resolves.toEqual(['cred-a'])
  })
})
