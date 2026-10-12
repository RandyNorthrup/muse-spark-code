import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTraceLogBuilder,
  parseTraceLine,
  type TraceAttempt,
  type TraceLogFacts,
  type TraceRun,
} from '../../src/core/usage/insights'
import { defaultTraceLogFs, splitTraceChunk } from '../../src/runtime/usage/traceLogs'
import { TRACE_LOG_MAX_BYTES } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})

/**
 * The pre-optimization whole-text parser, copied verbatim as the reference:
 * it splits on LF and CRLF exactly as the old reader did. The production
 * streaming reader must agree with it on every complete line; the one
 * deliberate difference is the torn tail (a trailing piece without its
 * newline), which the snapshot reader never reports and the reference
 * counts, covered by its own case below.
 */
function referenceParseTraceLog(text: string): TraceLogFacts {
  const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/
  const TURN_RUN = /event="runtime\.run\.lifecycle" run_kind="turn" .*?run_id=([\w-]+)/
  const SURFACE = /event="tool\.surface\.registered" run_id=([\w-]+) .*?registered_tool_count=(\d+)/
  const ADMISSION = /event="model\.attempt\.lifecycle" run_id="([^"]+)".*phase="admission"/
  const CHILD_RUN = /event="native_subagent\.child" .*?child_run_id=([\w-]+)/
  const LINE_BREAK = /\r?\n/
  const runs = new Map<string, TraceRun>()
  const attempts: TraceAttempt[] = []
  let firstMs: number | undefined
  let lastMs: number | undefined
  const withRun = (runId: string, change: Partial<Omit<TraceRun, 'runId'>>): void => {
    const current = runs.get(runId) ?? {
      runId,
      isTurn: false,
      isChild: false,
      registeredTools: undefined,
    }
    runs.set(runId, { ...current, ...change })
  }
  for (const line of text.split(LINE_BREAK)) {
    const stamp = TIMESTAMP.exec(line)?.[1]
    if (stamp === undefined) {
      continue
    }
    const atMs = Date.parse(stamp)
    firstMs ??= atMs
    lastMs = atMs
    const child = CHILD_RUN.exec(line)
    if (child?.[1] !== undefined) {
      withRun(child[1], { isChild: true })
      continue
    }
    const turn = TURN_RUN.exec(line)
    if (turn?.[1] !== undefined) {
      withRun(turn[1], { isTurn: true })
      continue
    }
    const surface = SURFACE.exec(line)
    if (surface?.[1] !== undefined && surface[2] !== undefined) {
      withRun(surface[1], { registeredTools: Number(surface[2]) })
      continue
    }
    const admission = ADMISSION.exec(line)
    if (admission?.[1] !== undefined) {
      attempts.push({ atMs, runId: admission[1] })
    }
  }
  return { firstMs, lastMs, attempts, runs }
}

// Deterministic generator: every event kind, both line endings, garbage.
function stamp(i: number): string {
  return i % 3 === 0
    ? '2026-09-23T03:49:59Z'
    : `2026-09-23T03:50:${String(i % 60).padStart(2, '0')}.${String(i % 1000).padStart(3, '0')}Z`
}

function lineEnding(i: number): string {
  return i % 2 === 0 ? '\n' : '\r\n'
}

function generateLog(seed: number, lines: number): string {
  let state = seed
  const next = (mod: number): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state % mod
  }
  const kinds: ((i: number) => string)[] = [
    (i) =>
      `${stamp(i)} INFO tbh.local.runtime x event="runtime.run.lifecycle" run_kind="turn" phase="started" command_id=r${String(i)} run_id=r${String(i)} outcome="running"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.tool x event="tool.surface.registered" run_id=r${String(i)} epoch_ordinal=0 registered_tool_count=${String(i % 31)} active_tool_count=1 outcome="registered"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="r${String(i)}" attempt_id="a" task_id="t" phase="admission" outcome="accepted"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="r${String(i)}" phase="terminal" outcome="completed"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.task x event="native_subagent.child" child_run_id=c${String(i)} state="started"`,
    (i) => `${stamp(i)} INFO heartbeat without any event marker`,
    (i) =>
      `garbage line ${String(i)} without a timestamp but with event="model.attempt.lifecycle" run_id="x" phase="admission"`,
    (i) => `${stamp(i)} INFO event="model.attempt.lifecycle" run_id="unclosed phase="admission"`,
    (i) =>
      `${stamp(i)} INFO event="other.thing" run_kind="turn" child_run_id=z${String(i)} phase="admission" registered_tool_count=3`,
    () =>
      `2026-13-45T99:99:99Z INFO event="model.attempt.lifecycle" run_id="bad" phase="admission"`,
    (i) =>
      `${'x'.repeat(5000)} ${stamp(i)} event="model.attempt.lifecycle" run_id="late" phase="admission"`,
    (i) =>
      `${stamp(i)} ${'y'.repeat(5000)} event="tool.surface.registered" run_id=big registered_tool_count=7`,
  ]
  let text = ''
  for (let i = 0; i < lines; i++) text += `${kinds[next(kinds.length)]?.(i) ?? ''}${lineEnding(i)}`
  return text
}

/**
 * The production streaming reader over a real file: no second splitter, no
 * whole-text path. The expected facts come from the reference parser over
 * the complete prefix (everything through the last newline): the torn tail,
 * when the input has one, is asserted separately.
 */
async function streamFileFacts(content: string | Buffer): Promise<TraceLogFacts> {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-trace-equiv-'))
  folders.push(folder)
  const file = path.join(folder, 'cli-equiv.log')
  writeFileSync(file, content)
  const size = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.length
  const builder = createTraceLogBuilder()
  await defaultTraceLogFs.streamLines(file, size, (line) => {
    parseTraceLine(builder, line)
  })
  return {
    firstMs: builder.firstMs,
    lastMs: builder.lastMs,
    attempts: builder.attempts,
    runs: builder.runs,
  }
}

function completePrefix(text: string): string {
  const lastNewline = text.lastIndexOf('\n')
  return lastNewline === -1 ? '' : text.slice(0, lastNewline + 1)
}

async function expectStreamEqualsReference(content: string | Buffer): Promise<void> {
  const text = typeof content === 'string' ? content : content.toString('utf8')
  await expect(streamFileFacts(content)).resolves.toEqual(
    referenceParseTraceLog(completePrefix(text)),
  )
}

describe('trace parser equivalence', () => {
  it.each([1, 7, 42, 999])(
    'the production streaming reader equals the old whole-text parser (seed %s)',
    async (seed) => {
      await expectStreamEqualsReference(generateLog(seed, 400))
    },
  )

  it('a torn tail is never reported, while the reference counts it', async () => {
    const full = generateLog(5, 100)
    const partial = full.slice(0, full.lastIndexOf('\n'))
    expect(partial.endsWith('\n')).toBe(false)
    const streamed = await streamFileFacts(partial)
    expect(streamed).toEqual(referenceParseTraceLog(completePrefix(partial)))
    // The difference is exactly the torn line: pin it so the policy cannot
    // drift silently.
    expect(referenceParseTraceLog(partial)).not.toEqual(streamed)
    const truncated = full.slice(0, 271)
    await expectStreamEqualsReference(truncated)
  })

  it('a lone CR stays inside its line instead of splitting it', async () => {
    const at = '2026-09-23T03:50:00.000Z'
    const content =
      `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="cr\revidence" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n` +
      `${at} INFO heartbeat with\ra lone CR and no event\n`
    const streamed = await streamFileFacts(content)
    // One line, not two pieces: the admission survives with its timestamp.
    expect(streamed.attempts).toHaveLength(1)
    expect(streamed).toEqual(referenceParseTraceLog(content))
  })

  it('a BOM, invalid UTF-8 and multibyte text parse as the whole-text read does', async () => {
    const at = '2026-09-23T03:50:00.000Z'
    const content = Buffer.concat([
      Buffer.from('\u{FEFF}', 'utf8'),
      Buffer.from(
        `${at} INFO heartbeat with emoji 💾 and CJK 日本語 event="other.thing"\n` +
          `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="bom" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`,
        'utf8',
      ),
      // Invalid bytes decode to replacement characters on both paths.
      Buffer.from([0xff, 0xfe, 0x0a]),
      Buffer.from(
        `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="after" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`,
        'utf8',
      ),
    ])
    const streamed = await streamFileFacts(content)
    // The BOM line has no parseable timestamp; both admissions after it count.
    expect(streamed.attempts.map((attempt) => attempt.runId)).toEqual(['bom', 'after'])
    await expectStreamEqualsReference(content)
  })

  it('a multibyte character split across stream chunks heals', async () => {
    // A file wide enough to span several stream chunks, with multibyte text
    // on every line so chunk cuts land mid-character wherever they fall.
    let text = ''
    for (let i = 0; i < 3000; i++)
      text += `2026-09-23T03:50:${String(i % 60).padStart(2, '0')}.000Z INFO 💾日本語 heartbeat ${String(i)}\n`
    text += `2026-09-23T03:50:59.000Z INFO tbh.local.model x event="model.attempt.lifecycle" run_id="wide" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(100_000)
    await expectStreamEqualsReference(text)
  })

  it('a line longer than a stream chunk and a line at the size cap parse whole', async () => {
    const at = '2026-09-23T03:50:00.000Z'
    const longLine = `${at} INFO padding ${'p'.repeat(200_000)} event="model.attempt.lifecycle" run_id="long" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`
    const streamed = await streamFileFacts(longLine)
    expect(streamed.attempts.map((attempt) => attempt.runId)).toEqual(['long'])
    expect(streamed).toEqual(referenceParseTraceLog(longLine))
    // A file of exactly the cap parses; a byte past it is skipped whole.
    const admissionLine = `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="cap" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`
    const fillerPrefix = `${at} INFO `
    const fillerLength =
      TRACE_LOG_MAX_BYTES -
      Buffer.byteLength(admissionLine, 'utf8') -
      Buffer.byteLength(fillerPrefix, 'utf8') -
      1
    const capped = `${fillerPrefix}${'f'.repeat(fillerLength)}\n${admissionLine}`
    expect(Buffer.byteLength(capped, 'utf8')).toBe(TRACE_LOG_MAX_BYTES)
    await expectStreamEqualsReference(capped)
  })

  it('an empty file and a file without a final newline parse to their complete lines', async () => {
    await expect(streamFileFacts('')).resolves.toEqual({
      firstMs: undefined,
      lastMs: undefined,
      attempts: [],
      runs: new Map(),
    })
    const at = '2026-09-23T03:50:00.000Z'
    const streamed = await streamFileFacts(
      `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="only" attempt_id="a" task_id="t" phase="admission" outcome="accepted"`,
    )
    // No newline yet: not a line, so nothing.
    expect(streamed.attempts).toEqual([])
    expect(streamed.firstMs).toBeUndefined()
  })

  it('a line matching two event patterns follows the same first-match order', async () => {
    const at = '2026-09-23T03:50:00.000Z'
    // Child, turn and admission markers on one line: the child wins, exactly
    // as the old check order says, and no attempt is recorded for it.
    const content =
      `${at} INFO tbh.local.task x event="native_subagent.child" child_run_id=c1 run_kind="turn" run_id="c1" event="model.attempt.lifecycle" phase="admission"\n` +
      `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="plain" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`
    const streamed = await streamFileFacts(content)
    expect(streamed.attempts.map((attempt) => attempt.runId)).toEqual(['plain'])
    expect(streamed.runs.get('c1')?.isChild).toBe(true)
    expect(streamed).toEqual(referenceParseTraceLog(content))
  })

  it('the production chunk splitter holds a straddling CRLF and keeps a lone CR', () => {
    expect(splitTraceChunk('', 'a\r')).toEqual({ lines: [], tail: 'a\r' })
    expect(splitTraceChunk('a\r', '\nb\n')).toEqual({ lines: ['a', 'b'], tail: '' })
    expect(splitTraceChunk('', 'x\ry\n')).toEqual({ lines: ['x\ry'], tail: '' })
    expect(splitTraceChunk('mid', 'dle\r\nend')).toEqual({ lines: ['middle'], tail: 'end' })
    expect(splitTraceChunk('', '')).toEqual({ lines: [], tail: '' })
  })
})
