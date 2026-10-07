// M80 lane C: the run step's launcher owner (SPEC §6.2, §6.5; D-M7, N2).
// G18 signals before/during exec and while a later child hangs, repeated
// signals and execCode kept apart from wrapper failures; G19 key intake and
// masking; G20 whole-patch withholding; G21 result extraction; G24 bounds,
// repeated stops, cancellation before publication and cleanup. Real Git and
// real child processes; the agent is test/action/fake-agent.mjs.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ActionStopError,
  ACTION_PUBLISH_MS,
  ACTION_STOP_GRACE_MS,
  ACTION_KILL_AFTER_MS,
} from '../../action/lib/lifecycle.mjs'
import {
  extractResult,
  isExecEvent,
  isExecResult,
  parseEventsText,
  PROHIBITED_UPDATE,
  RAW_TOOL_FIELDS,
} from '../../action/lib/result.mjs'
import {
  exitCodeFor,
  INVALID_KEY_MESSAGE,
  isBinaryPatch,
  maskCommand,
  MODEL_API_KEY_PATTERN,
  outputsFor,
  runProposal,
  scanCount,
  statusFor,
  takeModelApiKey,
} from '../../action/lib/run-exec.mjs'
import { execEventSchema, validateResult } from '../../src/runtime/exec/execProtocol'
import {
  EXEC_PROHIBITED_UPDATE_PATTERN,
  EXEC_RAW_TOOL_FIELDS,
  EXEC_STOP_GRACE_MS,
  MODEL_API_KEY_PATTERN as SOURCE_KEY_PATTERN,
} from '../../src/shared/constants'
import { resultRecord } from './helpers/execContract'
import {
  ACTION_DIR,
  byText,
  completedResult,
  fakeReports,
  fixtureRepo,
  isRecord,
  jsonRecord,
  NODE,
  PROCESS_SUITE,
  PERCENT_KEY,
  preparedRun,
  SECRET_TOKEN,
  tempLayout,
  TEST_KEY,
  TEST_TOKEN,
  testOwner,
  type PreparedRun,
  type TempLayout,
} from './helpers/actionFixtures'
import { TINY_PNG_BASE64 } from './helpers/fakeModelApi'

const isPosix = process.platform !== 'win32'
const encoder = new TextEncoder()

function envelope(seq: number, body: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, seq, time: '2026-10-02T00:00:00.000Z', ...body })
}

function resultLine(seq: number, result: unknown = completedResult()): string {
  return envelope(seq, { type: 'result', result })
}

async function until(isDone: () => boolean, withinMs = 10_000): Promise<void> {
  const deadline = Date.now() + withinMs
  while (!isDone()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * A hung fake command's handlers own SIGINT and SIGTERM: its `ready` line
 * follows them. Its key line comes first, while Node's defaults still apply.
 */
function isSignalReady(run: PreparedRun, command: 'exec' | 'scan-secrets'): boolean {
  return fakeReports(run.paths).some(
    (line) => line['command'] === command && line['ready'] === true,
  )
}

function outFiles(run: PreparedRun): string[] {
  return readdirSync(run.paths.out).toSorted(byText)
}

/** A binary patch is withheld before the secret scan: no patch file, no scan. */
function expectBinaryWithheld(run: PreparedRun, outputs: Record<string, string>): void {
  expect(outputs).toMatchObject({ 'patch-withheld': 'binary', 'patch-path': '' })
  expect(outFiles(run)).toEqual(['events.jsonl', 'result.json'])
  expect(fakeReports(run.paths).some((line) => line['command'] === 'scan-secrets')).toBe(false)
}

/** SIGTERM after exec completed: the patch is withheld as cancelled and the step exits 143. */
async function terminatedAfterExec(run: PreparedRun, running: Promise<ActionRunReport>) {
  run.test.send('SIGTERM')
  const report = await running
  await run.test.owner.cleanup()
  expect(report).toMatchObject({ execCode: 0, patchWithheld: 'cancelled', patchPublished: false })
  // RVM80CD P2-2: a stopped wrapper publishes nothing, not even the result.
  expect(outFiles(run)).toEqual([])
  expect(report.result).toBeNull()
  expect(exitCodeFor(report, run.test.owner)).toBe(143)
}

/** The whole run, then cleanup, then what the step would output and exit with. */
async function finish(run: PreparedRun) {
  const report = await runProposal(run.input)
  await run.test.owner.cleanup()
  return {
    report,
    outputs: outputsFor(report, run.test.owner, run.paths),
    code: exitCodeFor(report, run.test.owner),
  }
}

describe('G19 key intake and masking', () => {
  it('reproduces the exact source key pattern', () => {
    expect(MODEL_API_KEY_PATTERN.source).toBe(SOURCE_KEY_PATTERN.source)
    expect(MODEL_API_KEY_PATTERN.flags).toBe(SOURCE_KEY_PATTERN.flags)
  })

  it('deletes the variable, strips one LF and refuses empty, multi-line, oversize or malformed keys', () => {
    const take = (value: string | undefined) => {
      const env: Record<string, string | undefined> = {
        MUSE_SPARK_MODEL_API_KEY: value,
        OTHER: 'x',
      }
      const key = takeModelApiKey(env)
      expect(Object.hasOwn(env, 'MUSE_SPARK_MODEL_API_KEY')).toBe(false)
      return key
    }
    expect(take(`${TEST_KEY}\n`)).toBe(TEST_KEY)
    expect(take(PERCENT_KEY)).toBe(PERCENT_KEY)
    for (const refused of [
      undefined,
      '',
      '\n',
      `${TEST_KEY}\n\n`,
      `${TEST_KEY}\r\n`,
      `${TEST_KEY}\nLLM_second_line_value_x`,
      `LLM_${'a'.repeat(4093)}`,
      'not-a-key',
      ` ${TEST_KEY}`,
    ]) {
      expect(take(refused), String(refused).slice(0, 20)).toBeUndefined()
    }
    expect(take(`LLM_${'a'.repeat(4092)}`)).toHaveLength(4096)
  })

  it('escapes the mask command data', () => {
    expect(maskCommand(PERCENT_KEY)).toBe('::add-mask::LLM|123|before%25after+/.=$&\n')
    expect(maskCommand('a\r\nb%')).toBe('::add-mask::a%0D%0Ab%25\n')
  })

  it('the entry prints only the fixed error for an invalid key, and masks a valid one first', () => {
    const script = path.join(ACTION_DIR, 'lib', 'run-exec.mjs')
    const invalid = spawnSync(NODE, [script], {
      env: { PATH: process.env['PATH'], MUSE_SPARK_MODEL_API_KEY: 'LLM_short' },
      encoding: 'utf8',
    })
    expect(invalid.status).toBe(1)
    expect(invalid.stdout).toBe('')
    expect(invalid.stderr).toBe(`::error::${INVALID_KEY_MESSAGE}\n`)
    const valid = spawnSync(NODE, [script], {
      env: { PATH: process.env['PATH'], MUSE_SPARK_MODEL_API_KEY: `${PERCENT_KEY}\n` },
      encoding: 'utf8',
    })
    expect(valid.status).toBe(1)
    expect(valid.stdout).toBe(maskCommand(PERCENT_KEY))
    expect(valid.stderr).not.toContain(PERCENT_KEY)
  })
})

describe('G21 result extraction', () => {
  it('accepts exactly one valid final result after consecutive envelopes', () => {
    const tool = envelope(1, {
      type: 'tool',
      name: 'read_file',
      status: 'completed',
      durationMs: 1,
    })
    expect(parseEventsText(`${tool}\n${resultLine(2)}\n`)).toEqual(completedResult())
    for (const [name, text] of [
      ['no result', `${tool}\n`],
      ['cut mid-line', `${tool}\n${resultLine(2)}`],
      ['two results', `${resultLine(1)}\n${resultLine(2)}\n`],
      ['a line after', `${resultLine(1)}\n${tool.replace('"seq":1', '"seq":2')}\n`],
      ['bad sequence', `${tool}\n${resultLine(3)}\n`],
      ['malformed line', `{not json\n${resultLine(2)}\n`],
      ['unknown type', `${envelope(1, { type: 'chunk' })}\n${resultLine(2)}\n`],
      ['bad time', `${resultLine(1).replace('2026-10-02T00:00:00.000Z', 'yesterday')}\n`],
      ['extra envelope field', `${resultLine(1).replace('"v":1', '"v":1,"x":1')}\n`],
      ['empty', ''],
    ] as const) {
      expect(parseEventsText(text), name).toBeUndefined()
    }
  })

  it('mirrors the lane A result schema on valid and invalid records (parity)', () => {
    const base = resultRecord()
    const ledger = base.ledger!
    const valid = [
      base,
      completedResult({ status: 'failed', exitCode: 4, error: { kind: 'failed', message: 'x' } }),
      completedResult({
        status: 'cancelled',
        exitCode: 130,
        signal: 'SIGINT',
        error: { kind: 'c', message: '' },
      }),
      completedResult({
        status: 'accounting_unverified',
        exitCode: 9,
        error: { kind: 'accounting', message: '' },
      }),
    ]
    const invalid = [
      completedResult({ exitCode: 1 }),
      completedResult({
        status: 'cancelled',
        exitCode: 143,
        signal: null,
        error: { kind: 'c', message: '' },
      }),
      completedResult({
        status: 'cancelled',
        exitCode: 130,
        signal: 'SIGTERM',
        error: { kind: 'c', message: '' },
      }),
      completedResult({ error: { kind: 'x', message: 'y' } }),
      completedResult({ stopReason: 'max_tokens' }),
      completedResult({ filesChanged: ['/abs/path'] }),
      completedResult({ filesChanged: ['a', 'a'] }),
      completedResult({ extra: true }),
      completedResult({ v: 2 }),
      completedResult({ ledger: { ...ledger, capUsd: 0.5 } }),
      completedResult({
        ledger: { ...ledger, lastResponse: { ...ledger.lastResponse!, usage: 'missing' } },
      }),
      completedResult({
        usage: {
          ...base.usage,
          costUsd: { settled: 0.1, uncertain: 0, reserved: 0, total: 0.2, isUpperBound: false },
        },
      }),
      completedResult({ usage: { ...base.usage, cachedTokens: 11 } }),
      completedResult({ inputs: [{ name: 'a/b', bytes: 1, chunks: 1, complete: true }] }),
      completedResult({ durationMs: -1 }),
    ]
    for (const record of valid) {
      expect(() => validateResult(record)).not.toThrow()
      expect(isExecResult(record)).toBe(true)
    }
    for (const [index, record] of invalid.entries()) {
      expect(() => validateResult(record), String(index)).toThrow()
      expect(isExecResult(record), String(index)).toBe(false)
    }
  })

  it('mirrors the lane A event schema on every variant, valid and invalid (parity, RVM80CD P2-3)', () => {
    const base = resultRecord()
    const last = base.ledger!.lastResponse!
    const totals = {
      capUsd: 1,
      settledUsd: 0.000002,
      uncertainUsd: 0,
      reservedUsd: 0,
      remainingUsd: 0.999998,
      requests: 1,
      tokens: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 },
      paid: base.usage.paid,
      breach: false,
      refusal: null,
      lastResponse: last,
    }
    const limits = { budgetUsd: 1, maxRequests: 30, timeoutSeconds: 1800 }
    const valid: Record<string, unknown>[] = [
      {
        type: 'start',
        agent: { name: 'muse-spark-code-acp', version: '0.10.1' },
        backend: 'modelApi',
        mode: 'plan',
        model: 'muse-spark-1.3-contributor',
        effort: null,
        sessionId: 's',
        ephemeral: true,
        paidFeatures: [],
        limits,
      },
      { type: 'update', update: { sessionUpdate: 'plan', entries: [{ content: 'x' }] } },
      { type: 'update', update: { sessionUpdate: 'future_non_tool', meta: { deep: [1, 'a'] } } },
      { type: 'tool', name: 'read_file', status: 'completed', durationMs: 3 },
      { type: 'message', itemId: 'm', kind: 'agentMessage', text: 'hi', complete: true },
      { type: 'permission_denied', toolCallId: 't', title: 'Write', kind: 'edit', paths: ['a'] },
      { type: 'question_declined', count: 1 },
      {
        type: 'attempt',
        n: 1,
        endpoint: 'responses',
        phase: 'settled',
        maxOutputTokens: 32_768,
        reservedUsd: 0.108135,
        outcome: 'priced',
        chargedUsd: 0.000002,
        terminal: 'completed',
        totals,
      },
      {
        type: 'attempt',
        n: 2,
        endpoint: 'images.generations',
        phase: 'admitted',
        reservedUsd: 0.01,
        totals,
      },
      {
        type: 'paid_use',
        feature: 'imageGeneration',
        n: 1,
        phase: 'returned',
        units: 1,
        usd: 0.01,
      },
      {
        type: 'paid_use',
        feature: 'imageGeneration',
        n: null,
        phase: 'refused',
        units: 1,
        usd: 0,
        reason: 'x',
      },
      { type: 'limit', limit: 'budget' },
      { type: 'signal', signal: 'SIGTERM' },
      { type: 'result', result: base },
    ]
    const invalid: Record<string, unknown>[] = [
      { type: 'tool', rawOutput: 'UNVALIDATED TOOL CONTENT' },
      { type: 'tool', name: 'read_file', status: 'completed', durationMs: 3, rawOutput: 'x' },
      { type: 'tool', name: 'read_file', status: 'completed', durationMs: -1 },
      { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'x' } } },
      { type: 'update', update: { sessionUpdate: 'tool_call_update' } },
      { type: 'update', update: { sessionUpdate: 'x', nested: { rawOutput: 'x' } } },
      { type: 'update', update: { sessionUpdate: 'x', list: [{ toolCallId: '1' }] } },
      { type: 'update', update: { sessionUpdate: 'x', deep: { sessionUpdate: 'tool_call' } } },
      { type: 'update', update: [] },
      { type: 'message', itemId: 'm', kind: 'thought', text: 'hi', complete: true },
      { type: 'permission_denied', toolCallId: 't', title: 'W', kind: 'edit', paths: ['/abs'] },
      { type: 'question_declined', count: 1.5 },
      { type: 'attempt', n: 0, endpoint: 'responses', phase: 'admitted', reservedUsd: 0.1, totals },
      { type: 'attempt', n: 1, endpoint: 'count', phase: 'admitted', reservedUsd: 0.1, totals },
      {
        type: 'attempt',
        n: 1,
        endpoint: 'responses',
        phase: 'admitted',
        reservedUsd: 0.1,
        totals: { ...totals, remainingUsd: 0.5 },
      },
      { type: 'paid_use', feature: 'webSearch', n: 1, phase: 'returned', units: 1, usd: 0.01 },
      { type: 'limit', limit: 'tokens' },
      { type: 'signal', signal: 'SIGKILL' },
      { type: 'start', agent: { name: 'a', version: 'b' } },
      { type: 'chunk' },
    ]
    const event = (body: Record<string, unknown>) => ({
      v: 1,
      seq: 1,
      time: '2026-10-02T00:00:00.000Z',
      ...body,
    })
    for (const [index, body] of valid.entries()) {
      expect(execEventSchema.safeParse(event(body)).success, `valid ${String(index)}`).toBe(true)
      expect(isExecEvent(event(body)), `valid ${String(index)}`).toBe(true)
    }
    for (const [index, body] of invalid.entries()) {
      expect(execEventSchema.safeParse(event(body)).success, `invalid ${String(index)}`).toBe(false)
      expect(isExecEvent(event(body)), `invalid ${String(index)}`).toBe(false)
    }
    expect(isExecEvent({ ...event(valid[3]!), seq: 0 })).toBe(false)
    expect(PROHIBITED_UPDATE.source).toBe(EXEC_PROHIBITED_UPDATE_PATTERN)
    expect(RAW_TOOL_FIELDS).toEqual(EXEC_RAW_TOOL_FIELDS)
    const leaked = envelope(1, { type: 'tool', rawOutput: 'UNVALIDATED TOOL CONTENT' })
    expect(parseEventsText(`${leaked}\n${resultLine(2)}\n`)).toBeUndefined()
  })

  describe('extractResult', PROCESS_SUITE, () => {
    let layout: TempLayout
    beforeEach(() => {
      layout = tempLayout(true)
    })
    afterEach(() => {
      layout.cleanup()
    })

    it('publishes a valid result atomically under paths with spaces, and refuses a disagreeing exit code', async () => {
      const run = await preparedRun(layout, { mode: 'review' })
      writeFileSync(run.paths.eventsTmp, `${resultLine(1)}\n`)
      expect(
        await extractResult({ owner: run.test.owner, paths: run.paths, execCode: 4 }),
      ).toBeNull()
      expect(existsSync(run.paths.result)).toBe(false)
      const result = await extractResult({ owner: run.test.owner, paths: run.paths, execCode: 0 })
      expect(result).toEqual(completedResult())
      expect(run.paths.result).toContain(' ')
      expect(validateResult(JSON.parse(readFileSync(run.paths.result, 'utf8')))).toEqual(result)
      expect(existsSync(run.paths.resultTmp)).toBe(false)
      expect(outFiles(run)).toEqual(['events.jsonl', 'result.json'])
      await run.test.owner.cleanup()
    })

    it('an extraction abandoned by a stop publishes nothing when it resumes (RVM80CD P2-2)', async () => {
      const run = await preparedRun(layout, { mode: 'review' })
      writeFileSync(run.paths.eventsTmp, `${resultLine(1)}\n`)
      const extracting = extractResult({ owner: run.test.owner, paths: run.paths, execCode: 0 })
      run.test.send('SIGTERM')
      await expect(extracting).rejects.toBeInstanceOf(ActionStopError)
      // The phase returned at once; its operation keeps going in the background.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(outFiles(run)).toEqual([])
      await run.test.owner.cleanup()
    })

    it('publishes nothing once the owner has stopped', async () => {
      const run = await preparedRun(layout, { mode: 'review' })
      writeFileSync(run.paths.eventsTmp, `${resultLine(1)}\n`)
      run.test.send('SIGTERM')
      await expect(
        extractResult({ owner: run.test.owner, paths: run.paths, execCode: 0 }),
      ).rejects.toBeInstanceOf(ActionStopError)
      expect(outFiles(run)).toEqual([])
      await run.test.owner.cleanup()
    })
  })
})

describe('the entry after cleanup (RVM80CD P2-5)', PROCESS_SUITE, () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  it.runIf(isPosix)(
    'a step output file that never opens cannot hold the step past its publication bound',
    async () => {
      const run = await preparedRun(layout, { mode: 'review' })
      const fifo = path.join(layout.root, 'github-output')
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0)
      const started = Date.now()
      const entry = spawnSync(NODE, [path.join(ACTION_DIR, 'lib', 'run-exec.mjs')], {
        env: {
          PATH: process.env['PATH'],
          MUSE_SPARK_MODEL_API_KEY: TEST_KEY,
          MUSE_INVOCATION: run.paths.invocation,
          MUSE_CHECKOUT: run.paths.checkout,
          MUSE_NODE: NODE,
          MUSE_GIT: run.input.git,
          MUSE_AGENT_JS: run.input.agentJs,
          RUNNER_TEMP: layout.runnerTemp,
          GITHUB_WORKSPACE: layout.workspace,
          GITHUB_OUTPUT: fifo,
          GITHUB_RUN_ID: '4242',
          GITHUB_RUN_ATTEMPT: '1',
        },
        encoding: 'utf8',
        timeout: ACTION_PUBLISH_MS + 20_000,
      })
      // process.exit would wait at teardown for the worker stuck opening the
      // FIFO; the wrapper ends itself with SIGKILL after its error line.
      expect(entry.signal, entry.stderr).toBe('SIGKILL')
      expect(entry.stderr).toContain('::error::the step outputs did not finish in time')
      expect(entry.stderr).not.toContain(TEST_KEY)
      expect(Date.now() - started).toBeLessThan(ACTION_PUBLISH_MS + 15_000)
    },
  )
})

describe('the owner run (G18, G20, G24)', PROCESS_SUITE, () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  it('review: the key goes over stdin only, the child env is the allow-list, the result is published', async () => {
    const parentEnv = {
      ...process.env,
      GITHUB_TOKEN: TEST_TOKEN,
      MUSE_SPARK_MODEL_API_KEY: TEST_KEY,
      NODE_OPTIONS: '--require /trap.js',
      GIT_DIR: '/elsewhere',
    }
    const run = await preparedRun(layout, {
      mode: 'review',
      parentEnv,
      exec: { result: completedResult(), stderr: 'diagnostic {key}\n' },
    })
    const { report, outputs, code } = await finish(run)
    expect(code).toBe(0)
    expect(report).toMatchObject({
      execCode: 0,
      wrapperFailed: false,
      patchWithheld: '',
      diffTruncated: false,
    })
    expect(outputs).toMatchObject({
      status: 'completed',
      'exit-code': '0',
      'result-path': run.paths.result,
      'patch-path': '',
      requests: '1',
      'cost-usd': '0.000002',
    })
    const exec = fakeReports(run.paths).find((line) => line['command'] === 'exec')
    expect(exec?.['keyLine']).toBe(TEST_KEY)
    const args = Array.isArray(exec?.['args']) ? exec['args'] : []
    expect(args).not.toContain(TEST_KEY)
    expect(args.slice(0, 10)).toEqual([
      '--key-stdin',
      '--backend',
      'modelApi',
      '--cwd',
      run.paths.checkout,
      '--permission-mode',
      'plan',
      '--output',
      'jsonl',
      '--ephemeral',
    ])
    const env = isRecord(exec?.['env']) ? exec['env'] : {}
    expect(JSON.stringify(env)).not.toContain(TEST_KEY)
    expect(JSON.stringify(env)).not.toContain(TEST_TOKEN)
    for (const name of Object.keys(env)) {
      expect(name, name).not.toMatch(
        /^(GIT_|GITHUB_|ACTIONS_|RUNNER_|NODE_OPTIONS|NODE_PATH|MUSE_SPARK)/i,
      )
    }
    expect(run.logs.join('')).toBe('diagnostic [redacted]\n')
    const prompt = readFileSync(run.paths.prompt, 'utf8')
    expect(prompt).toContain('Tidy the notes')
    expect(prompt).not.toContain('Untrusted body')
    expect(readFileSync(run.paths.meta, 'utf8')).toContain('Untrusted body')
    expect(run.test.dropped()).toBe(true)
  })

  it('fix: a clean text patch and its manifest are published unchanged; staging is deleted', async () => {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: {
        result: completedResult(),
        writes: [
          { path: 'notes.txt', text: 'first\nsecond\nthird\n' },
          { path: 'docs/new.md', text: 'new\n' },
        ],
        removes: ['old.txt'],
      },
    })
    const { report, outputs } = await finish(run)
    expect(report.patchPublished).toBe(true)
    expect(outputs).toMatchObject({
      status: 'completed',
      'patch-path': run.paths.patch,
      'patch-withheld': '',
    })
    const patch = readFileSync(run.paths.patch)
    for (const line of ['+third', '+++ b/docs/new.md', '-plain line', 'deleted file mode']) {
      expect(patch.toString('utf8')).toContain(line)
    }
    expect(jsonRecord(readFileSync(run.paths.manifest, 'utf8'))).toEqual({
      headSha: run.repo.head,
      baseSha: run.repo.base,
      prNumber: 72,
      patchSha256: createHash('sha256').update(patch).digest('hex'),
      runId: '4242',
      attempt: '1',
      invocation: run.input.identity.invocation,
    })
    const scan = fakeReports(run.paths).find((line) => line['command'] === 'scan-secrets')
    expect(scan?.['keyLine']).toBe(TEST_KEY)
    expect(JSON.stringify(scan?.['env'])).not.toContain(TEST_KEY)
    expect(JSON.stringify(scan?.['args'])).not.toContain(TEST_KEY)
    expect(existsSync(run.paths.staging)).toBe(false)
    expect(outFiles(run)).toEqual(['events.jsonl', 'fix.patch', 'manifest.json', 'result.json'])
  })

  it('G20 withholds the whole patch for a secret in an added, removed or context line', async () => {
    const cases = [
      {
        name: 'added',
        repo: fixtureRepo(layout),
        writes: [{ path: 'notes.txt', text: `token ${SECRET_TOKEN}\n` }],
        removes: [],
      },
      {
        name: 'removed',
        repo: fixtureRepo(layout, SECRET_TOKEN),
        writes: [],
        removes: ['old.txt'],
      },
      {
        name: 'context',
        repo: fixtureRepo(layout, 'plain', SECRET_TOKEN),
        writes: [{ path: 'context.txt', text: `${SECRET_TOKEN}\nsecond changed\n` }],
        removes: [],
      },
      {
        name: 'exact key',
        repo: fixtureRepo(layout),
        writes: [{ path: 'notes.txt', text: `key ${TEST_KEY}\n` }],
        removes: [],
      },
    ]
    for (const item of cases) {
      const run = await preparedRun(layout, {
        mode: 'fix',
        repo: item.repo,
        exec: { result: completedResult(), writes: item.writes, removes: item.removes },
      })
      const { outputs } = await finish(run)
      expect(outputs['patch-withheld'], item.name).toBe('secret')
      expect(outputs['patch-path'], item.name).toBe('')
      expect(outFiles(run), item.name).toEqual(['events.jsonl', 'result.json'])
      expect(existsSync(run.paths.staging), item.name).toBe(false)
    }
  })

  it('G20 withholds a binary change (a generated PNG) whole and never scans it', async () => {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: {
        result: completedResult(),
        writes: [
          { path: 'generated/m80.png', base64: TINY_PNG_BASE64 },
          { path: 'notes.txt', text: 'text too\n' },
        ],
      },
    })
    const { outputs, code } = await finish(run)
    expect(code).toBe(0)
    expect(outputs).toMatchObject({ status: 'completed' })
    expectBinaryWithheld(run, outputs)
  })

  it('G20 withholds a NUL-bearing file that .gitattributes makes Git diff as text', async () => {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: {
        result: completedResult(),
        writes: [
          { path: '.gitattributes', text: '*.dat diff\n' },
          { path: 'data.dat', base64: Buffer.from('valid\u{0}utf8\u{0}\n').toString('base64') },
        ],
      },
    })
    const { outputs, code } = await finish(run)
    expect(code).toBe(0)
    expectBinaryWithheld(run, outputs)
  })

  it('G20 withholds on scanner exit 2, malformed or contradictory counts and output overflow', async () => {
    for (const [mode, expected] of [
      ['exit2', 'scan_failed'],
      ['malformed', 'scan_failed'],
      ['lie', 'scan_failed'],
      ['flood', 'limit'],
    ] as const) {
      const run = await preparedRun(layout, {
        mode: 'fix',
        exec: {
          result: completedResult(),
          writes: [{ path: 'notes.txt', text: mode === 'lie' ? `${SECRET_TOKEN}\n` : 'safe\n' }],
        },
        scan: { mode },
      })
      const { outputs } = await finish(run)
      expect(outputs['patch-withheld'], mode).toBe(expected)
      expect(outFiles(run), mode).not.toContain('fix.patch')
      expect(outFiles(run), mode).not.toContain('manifest.json')
    }
  })

  /** A fix run started until its scanner is running and hung. */
  async function hungScan() {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: { result: completedResult(), writes: [{ path: 'notes.txt', text: 'safe\n' }] },
      scan: { mode: 'hang' },
    })
    const running = runProposal(run.input)
    await until(() => isSignalReady(run, 'scan-secrets'))
    return { run, running }
  }

  it('G20/G24 a hung scanner is stopped at its deadline and nothing is published', async () => {
    const { run, running } = await hungScan()
    run.test.owner.stop({ kind: 'phase_timeout', phase: 'child' })
    const report = await running
    await run.test.owner.cleanup()
    const outputs = outputsFor(report, run.test.owner, run.paths)
    expect(outputs).toMatchObject({
      status: 'unknown',
      'patch-withheld': 'scan_failed',
      'patch-path': '',
    })
    expect(exitCodeFor(report, run.test.owner)).toBe(1)
    expect(outFiles(run)).not.toContain('fix.patch')
    expect(existsSync(run.paths.staging)).toBe(false)
  })

  it('G24 cancellation immediately before publication moves nothing', async () => {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: { result: completedResult(), writes: [{ path: 'notes.txt', text: 'safe\n' }] },
    })
    const owner = run.test.owner
    const watched = new Proxy(owner, {
      get(target, property, receiver): unknown {
        if (property === 'phase') {
          return (
            name: string,
            within: number,
            operation: (signal: AbortSignal) => Promise<unknown>,
          ) => {
            if (name === 'publish') run.test.send('SIGTERM')
            return target.phase(name, within, operation)
          }
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const report = await runProposal({ ...run.input, owner: watched })
    await owner.cleanup()
    expect(report.patchWithheld).toBe('cancelled')
    // RVM80CD P2-2: the cancelled wrapper withholds the result and events too.
    expect(outFiles(run)).toEqual([])
    expect(report.result).toBeNull()
    expect(statusFor(report, owner)).toBe('cancelled')
    expect(exitCodeFor(report, owner)).toBe(143)
  })

  it('G24 an oversize patch stops the run as limit', async () => {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: {
        result: completedResult(),
        writes: [{ path: 'big.txt', text: 'x'.repeat(17 * 1024 * 1024) }],
      },
    })
    const { outputs, code } = await finish(run)
    expect(outputs['patch-withheld']).toBe('limit')
    expect(code).toBe(1)
    expect(outFiles(run)).not.toContain('fix.patch')
  })

  it('G24 stderr overflow stops exec; execCode stays exec’s own and nothing is published', async () => {
    const run = await preparedRun(layout, {
      mode: 'review',
      exec: { hang: true, stderr: 'e'.repeat(1_100_000) },
    })
    const { report, outputs, code } = await finish(run)
    expect(run.test.owner.cause).toEqual({ kind: 'output_limit' })
    expect(report.execCode).not.toBe(0)
    expect(outputs).toMatchObject({ status: 'unknown', 'result-path': '' })
    expect(code).toBe(report.execCode)
  })

  it('G21 a missing, invalid or disagreeing result gives status unknown and keeps execCode', async () => {
    for (const [name, exec, execCode, exit] of [
      [
        'absent',
        {
          lines: [envelope(1, { type: 'tool', name: 'x', status: 'completed', durationMs: 1 })],
          exitCode: 0,
        },
        0,
        1,
      ],
      ['duplicate', { lines: [resultLine(1), resultLine(2)], exitCode: 0 }, 0, 1],
      ['disagreeing', { result: completedResult(), exitCode: 4 }, 4, 4],
      ['failed exec without result', { lines: [], exitCode: 5 }, 5, 5],
    ] as const) {
      const run = await preparedRun(layout, { mode: 'fix', exec })
      const { report, outputs, code } = await finish(run)
      expect(report.execCode, name).toBe(execCode)
      expect(outputs, name).toMatchObject({
        status: 'unknown',
        'result-path': '',
        'patch-withheld': 'no_result',
      })
      expect(code, name).toBe(exit)
      expect(outFiles(run), name).toEqual([])
    }
  })

  it('a valid noncompleted result is published for diagnostics but never authorizes a patch', async () => {
    const failed = completedResult({
      status: 'failed',
      exitCode: 4,
      error: { kind: 'failed', message: 'no' },
    })
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: { result: failed, writes: [{ path: 'notes.txt', text: 'x\n' }] },
    })
    const { outputs, code } = await finish(run)
    expect(outputs).toMatchObject({
      status: 'failed',
      'patch-withheld': 'not_completed',
      'patch-path': '',
    })
    expect(code).toBe(4)
    expect(outFiles(run)).toEqual(['events.jsonl', 'result.json'])
  })

  it('G18 a signal before exec starts nothing; the step exits with that signal', async () => {
    const run = await preparedRun(layout, { mode: 'review' })
    run.test.send('SIGINT')
    const { report, outputs, code } = await finish(run)
    expect(report.execCode).toBeNull()
    expect(fakeReports(run.paths)).toEqual([])
    expect(outputs['status']).toBe('cancelled')
    expect(code).toBe(130)
  })

  it.skipIf(!isPosix)(
    'G18 forwards the exact signal to exec and keeps its code apart (POSIX)',
    async () => {
      for (const [signal, execCode] of [
        ['SIGINT', 130],
        ['SIGTERM', 143],
      ] as const) {
        const run = await preparedRun(layout, { mode: 'review', exec: { hang: true } })
        const running = runProposal(run.input)
        await until(() => isSignalReady(run, 'exec'))
        run.test.send(signal)
        const report = await running
        await run.test.owner.cleanup()
        expect(
          fakeReports(run.paths)
            .map((line) => line['signal'])
            .filter(Boolean),
        ).toEqual([signal])
        expect(report.execCode).toBe(execCode)
        expect(exitCodeFor(report, run.test.owner)).toBe(execCode)
        expect(outFiles(run)).toEqual([])
      }
    },
  )

  it.skipIf(!isPosix)(
    'G18 escalates a child that ignores the signal at the kill bound, and at once on a repeat (POSIX)',
    async () => {
      const slow = { killAfterMs: 20_000, reapMs: 2000, cleanupMs: 3000 }
      const run = await preparedRun(layout, {
        mode: 'review',
        bounds: slow,
        exec: { hang: true, ignoreSignals: true },
      })
      const running = runProposal(run.input)
      await until(() => isSignalReady(run, 'exec'))
      run.test.send('SIGTERM')
      await until(() => fakeReports(run.paths).some((line) => line['signal'] === 'SIGTERM'))
      const repeated = Date.now()
      run.test.send('SIGTERM')
      const report = await running
      expect(Date.now() - repeated).toBeLessThan(5000)
      expect(report.execCode).toBe(137)
      await run.test.owner.cleanup()
      const fast = await preparedRun(layout, {
        mode: 'review',
        exec: { hang: true, ignoreSignals: true },
      })
      const fastRun = runProposal(fast.input)
      await until(() => isSignalReady(fast, 'exec'))
      const stopped = Date.now()
      fast.test.send('SIGINT')
      const killed = await fastRun
      expect(killed.execCode).toBe(137)
      expect(Date.now() - stopped).toBeGreaterThanOrEqual(350)
      await fast.test.owner.cleanup()
    },
  )

  it.skipIf(!isPosix)(
    'G18 a signal while the scanner hangs stops it; nothing later starts or publishes (POSIX)',
    async () => {
      const { run, running } = await hungScan()
      await terminatedAfterExec(run, running)
      expect(fakeReports(run.paths).filter((line) => line['signal'] === 'SIGTERM')).toHaveLength(1)
      expect(existsSync(run.paths.staging)).toBe(false)
    },
  )

  it.skipIf(!isPosix)(
    'G18 a signal while a patch Git child hangs after exec stops it; no scan or publication follows (POSIX)',
    async () => {
      const run = await preparedRun(layout, {
        mode: 'fix',
        exec: { result: completedResult(), writes: [{ path: 'notes.txt', text: 'safe\n' }] },
      })
      // Real Git for everything except intent-to-add, which hangs after leaving a marker.
      const marker = path.join(layout.root, 'git-hanging')
      const hanging = path.join(layout.root, 'hanging-git')
      writeFileSync(
        hanging,
        `#!/bin/sh\ncase "$*" in *--intent-to-add*) : > '${marker}'; exec sleep 600;; esac\nexec '${run.input.git}' "$@"\n`,
      )
      chmodSync(hanging, 0o755)
      const running = runProposal({ ...run.input, git: hanging })
      await until(() => existsSync(marker))
      await terminatedAfterExec(run, running)
      expect(fakeReports(run.paths).some((line) => line['command'] === 'scan-secrets')).toBe(false)
    },
  )
})

describe('lifecycle bounds and cleanup (G24)', PROCESS_SUITE, () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  it('keeps the bound constants equal to the exec stop values they reuse', () => {
    expect(ACTION_STOP_GRACE_MS).toBe(EXEC_STOP_GRACE_MS)
    expect(ACTION_KILL_AFTER_MS).toBe(EXEC_STOP_GRACE_MS + 2000)
  })

  it('a phase deadline stops the owner, and nothing starts after a stop', async () => {
    const { owner } = testOwner({})
    const never = new Promise<never>(() => {
      // Never settles: only the phase deadline can end it.
    })
    await expect(owner.phase('slow', 50, () => never)).rejects.toBeInstanceOf(ActionStopError)
    expect(owner.cause).toEqual({ kind: 'phase_timeout', phase: 'slow' })
    expect(owner.publicationAllowed).toBe(false)
    expect(() =>
      owner.child({
        file: NODE,
        args: ['-e', ''],
        cwd: layout.root,
        env: {},
        withinMs: 1000,
        stdoutMaxBytes: 1,
        stderrMaxBytes: 1,
      }),
    ).toThrow(ActionStopError)
    await expect(owner.phase('later', 1000, () => Promise.resolve(1))).rejects.toBeInstanceOf(
      ActionStopError,
    )
    owner.stop({ kind: 'signal', signal: 'SIGINT' })
    expect(owner.cause).toEqual({ kind: 'phase_timeout', phase: 'slow' })
    await owner.cleanup()
  })

  it('runs one child at a time and bounds its stdout', async () => {
    const { owner } = testOwner({})
    const base = {
      cwd: layout.root,
      env: { PATH: process.env['PATH'] ?? '' },
      withinMs: 10_000,
      stderrMaxBytes: 1000,
    }
    const first = owner.child({
      ...base,
      file: NODE,
      args: ['-e', 'setTimeout(() => {}, 300)'],
      stdoutMaxBytes: 10,
    })
    expect(() =>
      owner.child({ ...base, file: NODE, args: ['-e', ''], stdoutMaxBytes: 10 }),
    ).toThrow(/one child/)
    const firstOutcome = await first
    expect(firstOutcome.code).toBe(0)
    const flood = await owner.child({
      ...base,
      file: NODE,
      args: ['-e', 'process.stdout.write("x".repeat(100000))'],
      stdoutMaxBytes: 10,
    })
    expect(flood.stdout.length).toBeLessThanOrEqual(10)
    expect(owner.cause).toEqual({ kind: 'output_limit' })
    await owner.cleanup()
  })

  it.each(['memory', 'file'])(
    'bounds a %s review prefix while counting discarded stdout',
    async (storage) => {
      const { owner } = testOwner({})
      const file = path.join(layout.root, 'prefix')
      try {
        const outcome = await owner.child({
          file: NODE,
          args: ['-e', 'process.stdout.write("x".repeat(100000))'],
          cwd: layout.root,
          env: { PATH: process.env['PATH'] ?? '' },
          withinMs: 10_000,
          stdoutMaxBytes: 10,
          stderrMaxBytes: 1000,
          stdoutPrefixMaxBytes: 7,
          ...(storage === 'file' && { stdoutPath: file }),
        })
        expect(outcome.code).toBe(0)
        expect(outcome.stdoutTotalBytes).toBe(100_000)
        const prefix = storage === 'file' ? readFileSync(file) : outcome.stdout
        expect(Buffer.from(prefix).toString()).toBe('xxxxxxx')
        expect(owner.stopped).toBe(false)
        expect(() =>
          owner.child({
            file: NODE,
            args: ['-e', ''],
            cwd: layout.root,
            env: {},
            withinMs: 1000,
            stdoutMaxBytes: 10,
            stderrMaxBytes: 10,
            stdoutPrefixMaxBytes: 11,
          }),
        ).toThrow('existing output bound')
      } finally {
        await owner.cleanup()
      }
    },
  )

  it('cleanup stops and reaps a child still running, within the kill and reap bounds', async () => {
    const test = testOwner({})
    const stubborn = test.owner.child({
      file: NODE,
      args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
      cwd: layout.root,
      env: { PATH: process.env['PATH'] ?? '' },
      withinMs: 60_000,
      stdoutMaxBytes: 10,
      stderrMaxBytes: 10,
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const started = Date.now()
    await test.owner.cleanup()
    const outcome = await stubborn
    expect(outcome.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(test.owner.cleanupFailed).toBe(false)
    expect(test.owner.cause).toEqual({ kind: 'failure' })
    expect(test.dropped()).toBe(true)
  })

  it('records a cleanup failure, leaves only private residue, and still drops the secrets', async () => {
    const staging = path.join(layout.root, 'staging')
    mkdirSync(staging)
    writeFileSync(path.join(staging, 'held'), 'x')
    const test = testOwner({ staging })
    await test.owner.cleanup()
    expect(test.owner.cleanupFailed).toBe(true)
    expect(test.dropped()).toBe(true)
    expect(existsSync(path.join(staging, 'held'))).toBe(true)
  })

  it('classifies patches and scanner counts', () => {
    expect(isBinaryPatch(encoder.encode('diff --git a/x b/x\nGIT binary patch\nliteral 1\n'))).toBe(
      true,
    )
    expect(isBinaryPatch(encoder.encode('Binary files a/x and b/x differ\n'))).toBe(true)
    expect(isBinaryPatch(new Uint8Array([0xff, 0xfe]))).toBe(true)
    expect(isBinaryPatch(encoder.encode('diff --git a/x.dat b/x.dat\n+a\u{0}b\n'))).toBe(true)
    expect(isBinaryPatch(encoder.encode('+GIT binary patch in a line\n'))).toBe(false)
    expect(scanCount(encoder.encode('0 secret matches\n'))).toBe(0)
    expect(scanCount(encoder.encode('1 234 correspondances secrètes\n'))).toBe(1234)
    expect(scanCount(encoder.encode('12,345 secret matches'))).toBe(12_345)
    for (const malformed of ['clean\n', '1 and 2\n', '1\n2\n', '']) {
      expect(scanCount(encoder.encode(malformed)), malformed).toBeUndefined()
    }
  })
})
