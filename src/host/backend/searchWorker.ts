// The `search` tool's matcher, run on a worker thread (M7). The regular
// expression comes from the model, and a pathological one can hang the
// thread that evaluates it (ReDoS); a worker can be terminated when it
// overruns its budget, the extension host cannot. Reads the listed files,
// skips binary and oversized ones, and reports the matching lines.

import { readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import type { SearchHit, SearchJob, SearchOutcome } from '../../core/backends/modelapi/tools'
import { SEARCH_MAX_FILE_BYTES, SEARCH_MAX_HITS } from '../../shared/constants'

const LINE_BREAK = /\r?\n/

function isBinary(text: string): boolean {
  return text.includes('\0')
}

/** The matching lines of one file, at most `room` of them. */
function matchesIn(regex: RegExp, file: string, text: string, room: number): SearchHit[] {
  const hits: SearchHit[] = []
  for (const [index, line] of text.split(LINE_BREAK).entries()) {
    if (hits.length >= room) {
      break
    }
    if (regex.test(line)) {
      hits.push({ file, line: index + 1, text: line })
    }
  }
  return hits
}

async function run(job: SearchJob): Promise<SearchOutcome> {
  let regex: RegExp
  try {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the model's pattern, evaluated on this worker so the host can terminate a runaway match (PLAN.md §8)
    regex = new RegExp(job.pattern)
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const hits: SearchHit[] = []
  for (const file of job.files) {
    if (hits.length >= SEARCH_MAX_HITS) {
      break
    }
    let text: string
    try {
      text = await readFile(file.absolute, 'utf8')
    } catch {
      continue
    }
    if (text.length > SEARCH_MAX_FILE_BYTES || isBinary(text)) {
      continue
    }
    hits.push(...matchesIn(regex, file.relative, text, SEARCH_MAX_HITS - hits.length))
  }
  return { ok: true, hits }
}

const job = workerData as SearchJob
void run(job)
  .then((outcome) => {
    parentPort?.postMessage(outcome)
  })
  .catch((error: unknown) => {
    const outcome: SearchOutcome = {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
    parentPort?.postMessage(outcome)
  })
