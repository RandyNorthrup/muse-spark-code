// The page converter's start failure (src/host/web/pageConverter.ts): a
// worker that cannot start fails the conversion with the error's code,
// while the log names only the failure's kind (name and code) — never the
// message, which can quote the page.
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { ConversionSlots, pageConverter } from '../../src/host/web/pageConverter'
import { warnLogPair } from './helpers/memoryLogs'

it('fails closed on a worker that cannot start, without logging its message', async () => {
  // The real refusal: removing a file that is not there fails with ENOENT.
  let realRefusal: unknown
  try {
    await rm(path.join(tmpdir(), `no-such-page-${String(process.pid)}`), { force: false })
  } catch (error: unknown) {
    realRefusal = error
  }
  expect(realRefusal).toBeInstanceOf(Error)
  const startWorker = (): Worker => {
    throw realRefusal
  }
  const { log, warned } = warnLogPair()
  const convert = pageConverter(
    'pageWorker.js',
    log,
    undefined,
    startWorker,
    new ConversionSlots(1),
  )
  const outcome = await convert(
    { bytes: new Uint8Array(), charset: undefined, url: 'https://example.com/', maxChars: 100 },
    new AbortController().signal,
  )
  expect(outcome).toEqual({ ok: false, kind: 'failed', detail: 'ENOENT' })
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('did not start')
  expect(warned[0]).toContain('Error ENOENT')
  expect(warned[0]).not.toContain('no such file')
})
