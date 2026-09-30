// Web fetch's HTML converter on a worker thread (M69, PLAN.md D49), a bundle
// of its own (dist/pageWorker.js): parse5 and the converter load only in a
// worker started for a page, never at activation, and the extension host
// can stop the thread (pageConverter.ts) when a page passes its time or
// memory limit. One page per worker.

import { parentPort, workerData } from 'node:worker_threads'
import * as z from 'zod/mini'
import type { HtmlConversion } from '../../core/web/htmlConversion'
import { convertHtmlJob } from '../../core/web/htmlToMarkdown'
import { UndecodableText } from '../../core/web/textDecoding'

// The job crosses a thread boundary, so it is parsed like any other message
// (AGENTS.md rule 7), although only pageConverter.ts sends it.
const JOB = z.object({
  bytes: z.instanceof(Uint8Array),
  charset: z.optional(z.string()),
  url: z.string(),
  maxChars: z.number(),
})

function convert(): HtmlConversion {
  const job = JOB.safeParse(workerData)
  if (!job.success) {
    return { ok: false, kind: 'failed', detail: 'BAD_JOB' }
  }
  try {
    return { ok: true, page: convertHtmlJob({ ...job.data, charset: job.data.charset }) }
  } catch (error: unknown) {
    // An encoding this runtime has no decoder for: refused, never read as UTF-8.
    if (error instanceof UndecodableText) {
      return { ok: false, kind: 'undecodable', detail: error.encoding }
    }
    throw error
  }
}

parentPort?.postMessage(convert())
