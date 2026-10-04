// The `search` tool's matcher, run on a worker thread (M7). The regular
// expression comes from the model, and a pathological one can hang the
// thread that evaluates it (ReDoS); a worker can be terminated when it
// overruns its budget, the extension host cannot. Reads the listed files,
// skips binary and oversized ones and any whose canonical path leaves the
// workspace (a link to elsewhere, PLAN.md D24), and reports the matching
// lines.

import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import * as z from 'zod/mini'
import type {
  SearchHit,
  SearchJob,
  SearchOutcome,
  SearchWorkerMessage,
} from '../../core/backends/modelapi/tools'
import { compileDenyGlobsWithin } from '../../core/backends/modelapi/glob'

const LINE_BREAK = /\r?\n/

// The job crosses a thread boundary, so it is parsed like any other message
// (AGENTS.md rule 7), although only `toolIo.searchOnWorker` sends it.
const SEARCH_JOB = z.object({
  pattern: z.string(),
  root: z.string(),
  files: z.array(z.object({ relative: z.string(), absolute: z.string() })),
  maxFileBytes: z.number(),
  maxHits: z.number(),
  denyRead: z.array(z.string()),
  globLimits: z.object({ maxLength: z.number(), maxAlternatives: z.number() }),
})

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

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * The file's text when it is a small, confined, readable text file that the
 * permission settings do not deny by its canonical path (M78).
 */
async function searchableText(
  realRoot: string,
  absolute: string,
  maxFileBytes: number,
  isDenied: (relativePaths: readonly string[]) => boolean,
): Promise<string | undefined> {
  try {
    const real = await realpath(absolute)
    if (!isInside(realRoot, real)) {
      return undefined
    }
    if (isDenied([path.relative(realRoot, real).split(path.sep).join('/')])) {
      return undefined
    }
    const info = await stat(absolute)
    if (!info.isFile() || info.size > maxFileBytes) {
      return undefined
    }
    const text = await readFile(absolute, 'utf8')
    return isBinary(text) ? undefined : text
  } catch {
    // Vanished or unreadable since it was listed.
    return undefined
  }
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
  const realRoot = await realpath(job.root)
  const isDenied = compileDenyGlobsWithin(job.denyRead, job.globLimits)
  let found = 0
  for (const file of job.files) {
    if (found >= job.maxHits) {
      break
    }
    const text = await searchableText(realRoot, file.absolute, job.maxFileBytes, isDenied)
    if (text === undefined) {
      continue
    }
    const hits = matchesIn(regex, file.relative, text, job.maxHits - found)
    if (hits.length === 0) {
      continue
    }
    // Posted as found (D27): a search that runs out of time keeps them.
    post({ type: 'hits', hits })
    found += hits.length
  }
  // The hits went ahead; the end only says the search finished.
  return { ok: true, hits: [] }
}

function post(message: SearchWorkerMessage): void {
  parentPort?.postMessage(message)
}

/** A malformed job rejects here, so it is reported like any other failure. */
async function parsedRun(): Promise<SearchOutcome> {
  return await run(SEARCH_JOB.parse(workerData))
}

void parsedRun()
  .then((outcome) => {
    post({ type: 'done', outcome })
  })
  .catch((error: unknown) => {
    const outcome: SearchOutcome = {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
    post({ type: 'done', outcome })
  })
