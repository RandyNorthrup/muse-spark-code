import { Usd } from '../../../src/shared/usd'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertNoLiveKeyEnvironment,
  evalRunTimeoutMs,
  liveEvalSelection,
  liveToolIo,
  loadEvalLiveCredentials,
  unengagedLongOutputTasks,
  withPackingEngagement,
} from '../../e2e/evalLiveSupport'
import {
  type EvalReport,
  evalReportSchema,
  formatEvalReportJson,
  formatEvalReportMarkdown,
} from '../../../src/core/eval/report'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'
import {
  EVAL_MODEL_ID,
  EVAL_REPORT_VERSION,
  EVAL_TURN_TIMEOUT_MS,
  EVAL_VERIFY_TIMEOUT_MS,
  KEYRING_SERVICE,
  SECRET_KEYS,
} from '../../../src/shared/constants'
import { memorySecrets } from '../helpers/fakes'
import { FAKE_MODEL_API_ACCOUNT_ID, FAKE_MODEL_API_KEY } from '../helpers/fakeModelApi'
import { removeFolder } from '../helpers/temporaryFolders'

const native = vi.hoisted(() => ({
  open: vi.fn<(service: string, account: string, options: unknown) => void>(),
  getPassword: vi.fn<() => Promise<string | null | undefined>>(),
  setPassword: vi.fn<(value: string) => Promise<void>>(),
  deletePassword: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    public getPassword = native.getPassword
    public setPassword = native.setPassword
    public deletePassword = native.deletePassword

    public constructor(service: string, account: string, options: unknown) {
      native.open(service, account, options)
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  native.getPassword.mockResolvedValue(FAKE_MODEL_API_KEY)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function storedCredentials() {
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  return {
    secrets,
    get: vi.spyOn(secrets, 'get'),
    store: vi.spyOn(secrets, 'store'),
    remove: vi.spyOn(secrets, 'delete'),
  }
}

/** An environment naming the old variable whose value throws when read. */
function environmentWithLegacyKey() {
  const read = vi.fn(() => {
    throw new Error('the environment value must not be read')
  })
  const env: NodeJS.ProcessEnv = {}
  Object.defineProperty(env, 'MUSE_LIVE_MODEL_API_KEY', { get: read })
  return { env, read }
}

describe('secure live Model API credentials', () => {
  it('does not open or read a credential entry while live tests are disabled', async () => {
    const { secrets, get } = storedCredentials()
    await expect(loadEvalLiveCredentials(false, secrets)).rejects.toThrow('not enabled')
    expect(get).not.toHaveBeenCalled()
    expect(native.open).not.toHaveBeenCalled()
  })

  it('refuses legacy key environment presence without reading its value', () => {
    const { env, read } = environmentWithLegacyKey()
    expect(() => {
      assertNoLiveKeyEnvironment(env, true)
    }).toThrow('Remove that environment variable')
    expect(read).not.toHaveBeenCalled()
    expect(() => {
      assertNoLiveKeyEnvironment({}, true)
    }).not.toThrow()
  })

  it('lets a stale key variable pass while live tests are off, so the default run still collects', () => {
    const { env, read } = environmentWithLegacyKey()
    expect(() => {
      assertNoLiveKeyEnvironment(env, false)
    }).not.toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it('uses the existing OS entry in process, with Secret Service on Linux and no writes', async () => {
    const credentials = await loadEvalLiveCredentials(true)
    expect(credentials.accountId).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    expect(await credentials.apiKey()).toBe(FAKE_MODEL_API_KEY)
    expect(native.open).toHaveBeenCalledTimes(2)
    expect(native.open).toHaveBeenCalledWith(KEYRING_SERVICE, SECRET_KEYS.modelApiKey, {
      linux: { store: 'secret-service' },
    })
    expect(native.setPassword).not.toHaveBeenCalled()
    expect(native.deletePassword).not.toHaveBeenCalled()
    expect(JSON.stringify(credentials)).not.toContain(FAKE_MODEL_API_KEY)
  })

  it('reads only the injected secret entry and masks the key in text and byte scans', async () => {
    const { secrets, get, store, remove } = storedCredentials()
    const credentials = await loadEvalLiveCredentials(true, secrets)
    expect(get).toHaveBeenCalledWith(SECRET_KEYS.modelApiKey)
    expect(native.open).not.toHaveBeenCalled()
    expect(credentials.contains(Buffer.from(`before ${FAKE_MODEL_API_KEY} after`))).toBe(true)
    expect(credentials.contains('ordinary fixture text')).toBe(false)
    expect(credentials.redact(`${FAKE_MODEL_API_KEY} / ${FAKE_MODEL_API_KEY}`)).toBe(
      '[key] / [key]',
    )
    expect(store).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it.each(['missing', 'invalid', 'unreadable'] as const)(
    'fails closed with fixed text when the store is %s',
    async (kind) => {
      const { secrets, get } = storedCredentials()
      if (kind === 'missing') {
        secrets.values.clear()
      } else if (kind === 'invalid') {
        secrets.values.set(SECRET_KEYS.modelApiKey, 'not a credential')
      } else {
        get.mockRejectedValue(new Error(FAKE_MODEL_API_KEY))
      }
      let failure: unknown
      try {
        await loadEvalLiveCredentials(true, secrets)
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).toContain('operating system credential store')
      expect(String(failure)).not.toContain(FAKE_MODEL_API_KEY)
    },
  )

  it.each(['removed', 'replaced', 'unreadable'] as const)(
    'rereads the provider and refuses admission when its initial account is %s',
    async (kind) => {
      const { secrets, get } = storedCredentials()
      const credentials = await loadEvalLiveCredentials(true, secrets)
      expect(await credentials.apiKey()).toBe(FAKE_MODEL_API_KEY)
      if (kind === 'removed') {
        secrets.values.clear()
      } else if (kind === 'replaced') {
        secrets.values.set(SECRET_KEYS.modelApiKey, 'a different account')
      } else {
        get.mockRejectedValue(new Error(FAKE_MODEL_API_KEY))
      }
      expect(await credentials.apiKey()).toBeUndefined()
      expect(credentials.accountId).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    },
  )

  it('fails closed if a native failure cannot even be described safely', async () => {
    const { secrets, get } = storedCredentials()
    const credentials = await loadEvalLiveCredentials(true, secrets)
    get.mockRejectedValue({
      toString: () => {
        throw new Error('opaque store failure')
      },
    })
    await expect(credentials.apiKey()).resolves.toBeUndefined()
  })
})

// A real shell (PowerShell on Windows) starting Node; slow on a busy runner.
const SHELL_TIMEOUT_MS = 60_000
// Prints the three variables as the command sees them; no quote or `$`
// inside, so sh and PowerShell pass it to Node alike.
const PRINT_ENVIRONMENT =
  'node -e "process.stdout.write(JSON.stringify([process.env.OPENAI_API_KEY ?? null, process.env.META_API_KEY ?? null, process.env.MUSE_EVAL_PROBE ?? null]))"'

describe('live tool access', () => {
  it(
    'gives a shell command the model runs no credential variable, and the rest unchanged',
    async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), 'muse-eval-live-io-'))
      try {
        const io = liveToolIo({
          workspace,
          env: () => ({
            ...process.env,
            OPENAI_API_KEY: 'sentinel-openai',
            META_API_KEY: 'sentinel-meta',
            MUSE_EVAL_PROBE: 'kept',
          }),
          searchWorkerPath: path.join(workspace, 'searchWorker.js'),
          log: () => {
            // Nothing here kills a process tree.
          },
          shellJobAssembly: undefined,
        })
        const result = await io.runShell(PRINT_ENVIRONMENT, workspace, SHELL_TIMEOUT_MS)
        expect(result).toMatchObject({ exitCode: 0, isTimedOut: false })
        expect(JSON.parse(result.stdout.trim())).toEqual([null, null, 'kept'])
      } finally {
        await removeFolder(workspace)
      }
    },
    SHELL_TIMEOUT_MS,
  )
})

describe('live eval selection', () => {
  it('reads nothing while live tests are off, so a stale selection cannot fail the default run', () => {
    const read = vi.fn(() => 'no-such-task')
    const env: NodeJS.ProcessEnv = {}
    Object.defineProperty(env, 'MUSE_EVAL_TASKS', { get: read })
    expect(() => liveEvalSelection(env, false)).toThrow('not enabled')
    expect(read).not.toHaveBeenCalled()
  })

  it('stops an enabled run on an unknown task id', () => {
    expect(() =>
      liveEvalSelection({ MUSE_EVAL_TASKS: 'accept-off-by-one, no-such-task' }, true),
    ).toThrow('unknown eval tasks: no-such-task')
  })

  it('runs every task when unset, and the named ones in task-set order', () => {
    expect(liveEvalSelection({}, true)).toEqual({ tasks: EVAL_TASKS, reportPath: undefined })
    const [first, second] = EVAL_TASKS
    if (first === undefined || second === undefined) {
      throw new Error('the task set is too small')
    }
    expect(
      liveEvalSelection(
        { MUSE_EVAL_TASKS: ` ${second.id},,${first.id} `, MUSE_EVAL_REPORT: 'out/report' },
        true,
      ),
    ).toEqual({ tasks: [first, second], reportPath: 'out/report' })
  })
})

/** A report whose `packing` arm ran every task, with the ledger given per task. */
function packingReport(saved: Readonly<Record<string, number>>): EvalReport {
  const results = EVAL_TASKS.map((task) => ({
    taskId: task.id,
    title: task.title,
    split: task.split,
    passed: true,
    terminal: 'completed',
    failures: [],
    attempts: 1,
    requests: 1,
    inputTokens: 1,
    cachedTokens: 0,
    outputTokens: 1,
    costUsd: Usd.from(0).toAmount(),
    toolCalls: 0,
    approvals: 0,
    questions: 0,
    paidRefusals: 0,
    order: 1,
    recalls: 0,
    ...(saved[task.id] !== undefined && { packedTokensAvoided: saved[task.id] }),
  }))
  return {
    version: EVAL_REPORT_VERSION,
    model: EVAL_MODEL_ID,
    generatedAt: '2026-10-01T00:00:00.000Z',
    arms: [{ name: 'packing', results, summaries: [] }],
    floors: [],
    verdict: 'pass',
  }
}

describe('a packing run engaged', () => {
  const longIds = EVAL_TASKS.filter((task) => task.isLongOutput === true).map((task) => task.id)

  it('needs a packed placeholder on every long-output task it ran, and only those', () => {
    const everyLong = Object.fromEntries(longIds.map((id) => [id, 500]))
    expect(unengagedLongOutputTasks(packingReport(everyLong), 'packing', EVAL_TASKS)).toEqual([])
    const [first, ...rest] = longIds
    expect(
      unengagedLongOutputTasks(
        packingReport({ [first ?? '']: 0, ...Object.fromEntries(rest.map((id) => [id, 500])) }),
        'packing',
        EVAL_TASKS,
      ),
    ).toEqual([first])
    expect(unengagedLongOutputTasks(packingReport({}), 'packing', EVAL_TASKS)).toEqual(longIds)
  })

  it('counts an arm missing from the report as never engaged', () => {
    const everyLong = Object.fromEntries(longIds.map((id) => [id, 500]))
    expect(unengagedLongOutputTasks(packingReport(everyLong), 'other', EVAL_TASKS)).toEqual(longIds)
  })

  it('records a run whose floors pass but which never packed as failed, in both artifacts', () => {
    // Every task passed and no floor fell, yet no long-output task packed.
    const floorsPass = packingReport({})
    expect(floorsPass.verdict).toBe('pass')
    const report = withPackingEngagement(floorsPass, 'packing', EVAL_TASKS)
    expect(report.verdict).toBe('fail')
    const json = evalReportSchema.parse(JSON.parse(formatEvalReportJson(report)))
    expect(json.verdict).toBe('fail')
    expect(json.version === EVAL_REPORT_VERSION ? json.packingEngagement : undefined).toEqual({
      arm: 'packing',
      longOutputTasks: longIds,
      unengaged: longIds,
      held: false,
    })
    const markdown = formatEvalReportMarkdown(report)
    expect(markdown).toContain('verdict: fail')
    expect(markdown).not.toContain('verdict: pass')
    expect(markdown).toContain(`| packing | ${longIds.join(', ')} | ${longIds.join(', ')} | no |`)
  })

  it('leaves the verdict to the floors when packing engaged on every long-output task', () => {
    const everyLong = Object.fromEntries(longIds.map((id) => [id, 500]))
    const report = withPackingEngagement(packingReport(everyLong), 'packing', EVAL_TASKS)
    expect(report.verdict).toBe('pass')
    expect(formatEvalReportMarkdown(report)).toContain(
      `| packing | ${longIds.join(', ')} | none | yes |`,
    )
    // A selection without long-output tasks has nothing to engage.
    const small = EVAL_TASKS.filter((task) => task.isLongOutput !== true)
    const smallReport = withPackingEngagement(packingReport({}), 'packing', small)
    expect(smallReport.verdict).toBe('pass')
    expect(formatEvalReportMarkdown(smallReport)).toContain('| packing | none | none | yes |')
  })
})

const RUN_MARGIN_MS = 60_000
const ONE_RUN_MS = EVAL_TURN_TIMEOUT_MS + EVAL_VERIFY_TIMEOUT_MS

describe('live paired eval overall deadline', () => {
  it('keeps the existing one-arm deadline', () => {
    expect(evalRunTimeoutMs(10, 1, RUN_MARGIN_MS)).toBe(10 * ONE_RUN_MS + RUN_MARGIN_MS)
  })

  it('allows both arms their full task budgets before the overall timer expires', async () => {
    vi.useFakeTimers()
    const expired = vi.fn()
    const timer = setTimeout(expired, evalRunTimeoutMs(2, 2, RUN_MARGIN_MS))
    await vi.advanceTimersByTimeAsync(2 * ONE_RUN_MS + RUN_MARGIN_MS)
    expect(expired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2 * ONE_RUN_MS)
    expect(expired).toHaveBeenCalledOnce()
    clearTimeout(timer)
  })

  it.each([
    [0, 1, RUN_MARGIN_MS],
    [1, 0, RUN_MARGIN_MS],
    [-1, 1, RUN_MARGIN_MS],
    [1.5, 1, RUN_MARGIN_MS],
    [1, 1, -1],
    [Number.MAX_SAFE_INTEGER, 2, RUN_MARGIN_MS],
    [1, Infinity, RUN_MARGIN_MS],
  ])('refuses invalid counts/margin %j', (tasks, arms, margin) => {
    expect(() => evalRunTimeoutMs(tasks, arms, margin)).toThrow('valid task and arm counts')
  })
})
