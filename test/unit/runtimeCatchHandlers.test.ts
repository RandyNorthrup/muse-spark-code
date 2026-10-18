// D119 catch burn-down: runtime handlers name their expected failure and
// rethrow the rest. Every test drives the real code into its real failure:
// a missing file, a refused permission, a vanished listing entry, malformed
// arguments, a corrupt store, a failing key read.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { runEstimateCommand } from '../../src/runtime/estimator/command'
import { nodeFontInstallPort } from '../../src/runtime/fonts/nodeInstall'
import { runPlaybookCommand, type PlaybookSurfacePort } from '../../src/runtime/playbook/command'
import { parseAccountsCommand } from '../../src/runtime/providers/accountArgs'
import { runtimeSharingConfidential } from '../../src/runtime/sharing/sharingEntry'
import { runUsageCommand } from '../../src/runtime/usage/usageCli'
import { serveUsageStdio } from '../../src/runtime/usage/usageServiceEntry'
import {
  checkDeveloperAccount,
  createRuntimeAccountServices,
} from '../../src/runtime/providers/runtimeServices'
import { cancelAfterFailedDeferral } from '../../src/runtime/questions/acpRegistry'
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
import { RESOURCE_JOURNAL_RESET_FILE, SETTING_DEFAULTS, UI_TEXT } from '../../src/shared/constants'
import { estimateSectionSchema } from '../../src/shared/estimate'
import { fill } from '../../src/shared/l10n/text'
import type { UsageService } from '../../src/core/usage/usageService'
import type { UsageServiceToPageMessage } from '../../src/shared/usagePage'

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

/** A contract failure the estimator never worded, built by its real schema. */
function foreignEstimateFailure(): Error {
  try {
    estimateSectionSchema.parse({})
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('the estimate contract did not refuse an empty section')
}

describe('estimate command floor', () => {
  it('exits 1 with fixed words when the run fails, never exception text', async () => {
    const written: string[] = []
    const errors: string[] = []
    const code = await runEstimateCommand(['M1'], {
      context: () => ({ asOf: new Date().toISOString(), optimize: 'cost' as const }),
      runner: { estimate: () => Promise.reject(foreignEstimateFailure()) },
      money: { price: () => '' },
      write: (text) => {
        written.push(text)
      },
      error: (text) => {
        errors.push(text)
      },
      signal: new AbortController().signal,
    })
    expect(code).toBe(1)
    expect(errors).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' })])
    expect(written).toEqual([])
  })
})

describe('playbook command floor', () => {
  it('answers a failed port read with fixed words, never exception text', async () => {
    const failing: PlaybookSurfacePort = {
      read: () => Promise.reject(Object.assign(new Error('journal locked'), { code: 'EBUSY' })),
      change: () => Promise.reject(new Error('unused in this path')),
    }
    const result = await runPlaybookCommand({ view: 'status' }, failing)
    expect(result).toEqual({ ok: false, text: UI_TEXT.playbookCommandFailed })
  })
})

function seedMeta(dir: string): void {
  writeFileSync(
    path.join(dir, 'providers.json'),
    JSON.stringify({
      providers: {
        meta: {
          id: 'meta',
          policyProvider: 'meta',
          product: 'model-api',
          auth: 'apiKey',
          origin: 'https://api.meta.ai',
          accounts: [{ id: 'default', label: 'Default', order: 0, thresholds: {} }],
        },
      },
    }),
    'utf8',
  )
}

async function checkAccount(dir: string, provider: string, account: string): Promise<void> {
  const services = createRuntimeAccountServices({
    dataDir: dir,
    openEntry: () => {
      throw new Error('unused in this path')
    },
  })
  await checkDeveloperAccount(services.metadata, services.store, provider, account)
}

const pack = (): ReadonlyMap<string, Uint8Array> =>
  new Map([['a.woff2', new Uint8Array([1, 2, 3])]])

describe('developer account check', () => {
  it('passes a configured account', async () => {
    const dir = folder()
    seedMeta(dir)
    await expect(checkAccount(dir, 'meta', 'default')).resolves.toBeUndefined()
  })

  it('refuses an unknown account as invalid, not as unavailable', async () => {
    const dir = folder()
    seedMeta(dir)
    await expect(checkAccount(dir, 'meta', 'ghost')).rejects.toThrow(
      UI_TEXT.developer.invalidRequest,
    )
  })

  it('refuses an unconfigured provider as invalid', async () => {
    const dir = folder()
    seedMeta(dir)
    await expect(checkAccount(dir, 'other', 'default')).rejects.toThrow(
      UI_TEXT.developer.invalidRequest,
    )
  })
})

describe('font pack publication', () => {
  it('publishes a fresh pack and reuses a matching one', async () => {
    const dir = folder()
    const port = nodeFontInstallPort({ directory: dir, fetch })
    const destination = await port.publish('v1', pack())
    expect(destination).toBe(path.join(dir, 'v1'))
    expect(await readFile(path.join(destination, 'a.woff2'))).toEqual(Buffer.from([1, 2, 3]))
    await expect(port.publish('v1', pack())).resolves.toBe(destination)
  })

  it('refuses to clobber a mismatched pack and leaves it untouched', async () => {
    const dir = folder()
    const destination = path.join(dir, 'v1')
    await mkdir(destination, { recursive: true })
    writeFileSync(path.join(destination, 'a.woff2'), Buffer.from([9, 9, 9]))
    const port = nodeFontInstallPort({ directory: dir, fetch })
    await expect(port.publish('v1', pack())).rejects.toThrow()
    expect(await readFile(path.join(destination, 'a.woff2'))).toEqual(Buffer.from([9, 9, 9]))
  })

  it('settles concurrent publishers on one destination', async () => {
    const dir = folder()
    const port = nodeFontInstallPort({ directory: dir, fetch })
    const [first, second] = await Promise.all([
      port.publish('v1', pack()),
      port.publish('v1', pack()),
    ])
    expect(first).toBe(path.join(dir, 'v1'))
    expect(second).toBe(path.join(dir, 'v1'))
    expect(await readFile(path.join(dir, 'v1', 'a.woff2'))).toEqual(Buffer.from([1, 2, 3]))
  })
})

describe('failed deferral fallback', () => {
  it('reports a failed cancel and resolves', async () => {
    let marks = 0
    await cancelAfterFailedDeferral(
      {
        cancelQuestions: () => Promise.reject(new Error('cancel blew up')),
      },
      'q1',
      () => {
        marks += 1
      },
    )
    expect(marks).toBe(1)
  })

  it('stays silent when the fallback succeeds', async () => {
    let marks = 0
    await cancelAfterFailedDeferral({ cancelQuestions: () => Promise.resolve() }, 'q1', () => {
      marks += 1
    })
    expect(marks).toBe(0)
  })
})

function settingsFile(dir: string, content: string): void {
  mkdirSync(path.join(dir, '.vscode'), { recursive: true })
  writeFileSync(path.join(dir, '.vscode', 'settings.json'), content, 'utf8')
}

describe('sharing confidentiality read', () => {
  it('reads the default without a settings file', () => {
    expect(runtimeSharingConfidential(folder())).toBe(SETTING_DEFAULTS.confidentialWorkspace)
  })

  it('reads a stored policy value', () => {
    const dir = folder()
    settingsFile(dir, '{"museSpark.confidentialWorkspace": true}')
    expect(runtimeSharingConfidential(dir)).toBe(true)
  })

  it('refuses admission on a corrupt policy file', () => {
    const dir = folder()
    settingsFile(dir, '{oops')
    expect(runtimeSharingConfidential(dir)).toBeUndefined()
  })

  it('refuses admission on a mis-shaped policy file', () => {
    const dir = folder()
    settingsFile(dir, '{"museSpark.confidentialWorkspace": "yes"}')
    expect(runtimeSharingConfidential(dir)).toBeUndefined()
  })

  it.runIf(isPosix)('refuses admission on a refused policy read', () => {
    const dir = folder()
    settingsFile(dir, '{"museSpark.confidentialWorkspace": true}')
    chmodSync(path.join(dir, '.vscode', 'settings.json'), 0o000)
    expect(runtimeSharingConfidential(dir)).toBeUndefined()
  })
})

function unusedPort(): never {
  throw new Error('unused in this path')
}

async function* lines(...items: string[]): AsyncGenerator<string> {
  await Promise.resolve()
  yield* items
}

function stdioPorts(
  input: string[],
  receive: () => Promise<void>,
): {
  printed: string[]
  disposed: { count: number }
  ports: {
    usage: {
      connect: () => { receive: () => Promise<void>; dispose: () => void }
      read: () => Promise<never>
      usageText: () => never
      export: () => Promise<never>
    }
    openPage: () => Promise<never>
    openBrowser: () => Promise<never>
    writeFile: () => Promise<never>
    input: string[]
    print: (text: string) => Promise<void>
  }
} {
  const printed: string[] = []
  const disposed = { count: 0 }
  return {
    printed,
    disposed,
    ports: {
      usage: {
        connect: () => ({
          receive,
          dispose: () => {
            disposed.count += 1
          },
        }),
        read: unusedPort,
        usageText: unusedPort,
        export: unusedPort,
      },
      openPage: unusedPort,
      openBrowser: unusedPort,
      writeFile: unusedPort,
      input,
      print: (text: string) => {
        printed.push(text)
        return Promise.resolve()
      },
    },
  }
}

function boundaryPorts(
  requests: string[],
  handle: (input: unknown) => Promise<UsageServiceToPageMessage[]>,
): {
  sent: string[]
  service: UsageService
  ports: {
    requests: AsyncGenerator<string>
    sendLine: (line: string) => Promise<void>
  }
} {
  const sent: string[] = []
  return {
    sent,
    service: { snapshot: unusedPort, handle },
    ports: {
      requests: lines(...requests),
      sendLine: (line: string) => {
        sent.push(line)
        return Promise.resolve()
      },
    },
  }
}

describe('usage stdio pump', () => {
  it('reports a malformed line and a failed message, and survives both', async () => {
    const failure = new Error('backend blew up')
    const { printed, disposed, ports } = stdioPorts(['{oops', '{"type":"usage/refresh"}'], () =>
      Promise.reject(failure),
    )
    await expect(runUsageCommand({ action: 'stdio' }, ports)).resolves.toBe(0)
    expect(printed).toEqual([
      `${JSON.stringify({ type: 'usage/error', code: 'invalidMessage' })}\n`,
      `${JSON.stringify({ type: 'usage/error', code: 'readFailed' })}\n`,
    ])
    expect(disposed.count).toBe(1)
  })

  it('lets a failed print keep its kind', async () => {
    const failure = new Error('print blew up')
    const { ports } = stdioPorts(['{"type":"usage/refresh"}'], () =>
      Promise.reject(new Error('backend blew up')),
    )
    ports.print = () => Promise.reject(failure)
    await expect(runUsageCommand({ action: 'stdio' }, ports)).rejects.toBe(failure)
  })
})

describe('usage stdio service boundary', () => {
  it('refuses a malformed line as invalid', async () => {
    const { sent, service, ports } = boundaryPorts(['{oops'], unusedPort)
    await serveUsageStdio(service, ports)
    expect(sent).toEqual([`${JSON.stringify({ type: 'usage/error', code: 'invalidMessage' })}\n`])
  })

  it('refuses an oversized line without reaching the service', async () => {
    const { sent, service, ports } = boundaryPorts(['x'.repeat(5000)], unusedPort)
    await serveUsageStdio(service, ports)
    expect(sent).toEqual([`${JSON.stringify({ type: 'usage/error', code: 'invalidMessage' })}\n`])
  })

  it('reports a failing read as readFailed, not invalid', async () => {
    const { sent, service, ports } = boundaryPorts(['{"type":"usage/refresh"}'], () =>
      Promise.reject(new Error('backend blew up')),
    )
    await serveUsageStdio(service, ports)
    expect(sent).toEqual([`${JSON.stringify({ type: 'usage/error', code: 'readFailed' })}\n`])
  })

  it('keeps a malformed service input invalid', async () => {
    const { sent, service, ports } = boundaryPorts(['[1,2,3]'], () =>
      Promise.reject(foreignEstimateFailure()),
    )
    await serveUsageStdio(service, ports)
    expect(sent).toEqual([`${JSON.stringify({ type: 'usage/error', code: 'invalidMessage' })}\n`])
  })
})
