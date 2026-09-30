import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HtmlJob } from '../../src/core/web/htmlConversion'
import {
  ConversionSlots,
  type ConverterLimits,
  pageConverter,
  type StartWorker,
} from '../../src/host/web/pageConverter'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'

// The worker's own bundle, built as `npm run build` builds dist/pageWorker.js.
const dir = mkdtempSync(path.join(tmpdir(), 'muse-page-worker-'))
const workerPath = path.join(dir, 'pageWorker.js')
const NOT_STOPPED = new AbortController().signal
const LIMITS: ConverterLimits = { timeoutMs: 10_000, maxHeapMib: 512 }
const SHORT: ConverterLimits = { timeoutMs: 500, maxHeapMib: 512 }
const EXIT_WITHIN_MS = 3000
// A page parse5 takes about a minute to parse (quadratic on nesting).
const SLOW_PAGE = '<ul><li>'.repeat(40_000)

beforeAll(async () => {
  await build({
    entryPoints: ['src/host/web/pageWorker.ts'],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
  })
}, 60_000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function job(html: string): HtmlJob {
  return {
    bytes: new Uint8Array(Buffer.from(html, 'utf8')),
    charset: undefined,
    url: 'https://docs.example.com/guide/',
    maxChars: 100_000,
  }
}

/** A stand-in worker script: what the real one must never do. */
function fakeWorker(name: string, source: string): string {
  const file = path.join(dir, name)
  writeFileSync(file, source)
  return file
}

/** Node's workers, kept so a test can see each one end. */
function watchedWorkers(): { start: StartWorker; started: Worker[] } {
  const started: Worker[] = []
  return {
    started,
    start: (file: string, options: WorkerOptions) => {
      const worker = new Worker(file, options)
      started.push(worker)
      return worker
    },
  }
}

/** Whether the worker's thread ended within the wait (its exit event, or already gone). */
async function hasExited(worker: Worker | undefined): Promise<boolean> {
  if (worker === undefined) {
    return false
  }
  if (worker.threadId === -1) {
    return true
  }
  const timeout = new Promise<false>((resolve) => {
    setTimeout(() => {
      resolve(false)
    }, EXIT_WITHIN_MS)
  })
  const exited = (async () => {
    await once(worker, 'exit')
    return true
  })()
  return await Promise.race([exited, timeout])
}

describe("web fetch's page converter on a worker thread (M69)", () => {
  it('converts a page on the worker, from its bytes', async () => {
    const outcome = await pageConverter(workerPath, new FakeLogOutputChannel())(
      job('<title>Guide</title><p>Hello <b>you</b> <a href="next">on</a>'),
      NOT_STOPPED,
    )
    expect(outcome).toEqual({
      ok: true,
      page: {
        title: 'Guide',
        markdown: 'Hello **you** [on](https://docs.example.com/guide/next)',
        isTruncated: false,
      },
    })
  })

  it('stops a page slow to parse at the time limit, and its thread ends', async () => {
    const workers = watchedWorkers()
    const started = performance.now()
    const outcome = await pageConverter(
      workerPath,
      new FakeLogOutputChannel(),
      SHORT,
      workers.start,
    )(job(SLOW_PAGE), NOT_STOPPED)
    expect(outcome).toEqual({ ok: false, kind: 'timeout', detail: '500' })
    expect(performance.now() - started).toBeLessThan(5000)
    expect(await hasExited(workers.started[0])).toBe(true)
  })

  it('stops a converter that passes its heap limit', async () => {
    const hog = fakeWorker(
      'hog.js',
      'const kept = []; for (;;) { kept.push(new Array(1_000_000).fill(kept.length)) }',
    )
    const outcome = await pageConverter(hog, new FakeLogOutputChannel(), {
      timeoutMs: 20_000,
      maxHeapMib: 32,
    })(job('<p>x'), NOT_STOPPED)
    expect(outcome).toEqual({ ok: false, kind: 'memory', detail: 'ERR_WORKER_OUT_OF_MEMORY' })
  })

  it('refuses the page when the converter cannot load, fails or answers in another shape', async () => {
    const log = new FakeLogOutputChannel()
    const missing = await pageConverter(path.join(dir, 'missing.js'), log)(job('<p>x'), NOT_STOPPED)
    expect(missing).toMatchObject({ ok: false, kind: 'failed' })
    const odd = fakeWorker(
      'odd.js',
      "require('node:worker_threads').parentPort.postMessage({ ok: true, page: 7 })",
    )
    expect(await pageConverter(odd, log)(job('<p>x'), NOT_STOPPED)).toEqual({
      ok: false,
      kind: 'failed',
      detail: 'BAD_ANSWER',
    })
    // A crash: its name, code and frames reach the log, never its message.
    const crash = fakeWorker(
      'crash.js',
      "const e = new TypeError('page text: secret'); e.code = 'ERR_X'; throw e",
    )
    expect(await pageConverter(crash, log)(job('<p>x'), NOT_STOPPED)).toEqual({
      ok: false,
      kind: 'failed',
      detail: 'ERR_X',
    })
    const logged = logLines(log).join('\n')
    expect(logged).toContain('Web fetch: the page converter failed: TypeError ERR_X | at ')
    expect(logged).not.toContain('secret')
  })

  it('stops with the fetch, and its thread ends', async () => {
    const workers = watchedWorkers()
    const stop = new AbortController()
    const converting = pageConverter(
      workerPath,
      new FakeLogOutputChannel(),
      LIMITS,
      workers.start,
    )(job(SLOW_PAGE), stop.signal)
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
    stop.abort()
    expect(await converting).toEqual({ ok: false, kind: 'failed', detail: 'STOPPED' })
    expect(await hasExited(workers.started[0])).toBe(true)
    const stopped = new AbortController()
    stopped.abort()
    expect(
      await pageConverter(workerPath, new FakeLogOutputChannel())(job('<p>x'), stopped.signal),
    ).toEqual({ ok: false, kind: 'failed', detail: 'STOPPED' })
  })

  it('runs at most two conversions at once; a waiting one ends with its fetch', async () => {
    const slots = new ConversionSlots(2)
    const workers = watchedWorkers()
    const convert = pageConverter(
      workerPath,
      new FakeLogOutputChannel(),
      SHORT,
      workers.start,
      slots,
    )
    const stopThird = new AbortController()
    const first = convert(job(SLOW_PAGE), NOT_STOPPED)
    const second = convert(job(SLOW_PAGE), NOT_STOPPED)
    const third = convert(job('<p>x'), stopThird.signal)
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
    expect(workers.started).toHaveLength(2)
    stopThird.abort()
    expect(await third).toEqual({ ok: false, kind: 'failed', detail: 'STOPPED' })
    // A slot freed by the first two lets the next page through.
    await Promise.all([first, second])
    const fourth = await convert(job('<p>four'), NOT_STOPPED)
    expect(fourth).toMatchObject({ ok: true, page: { markdown: 'four' } })
    expect(workers.started).toHaveLength(3)
  })
})
