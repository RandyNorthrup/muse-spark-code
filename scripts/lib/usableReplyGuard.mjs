// The capped-turn rule (tool rounds, round 7): no consumer reads a turn's
// reply as a result through the raw completed terminal. The one accessor is
// `usableReply` (src/core/turns/usableReply.ts); every other completed-
// terminal comparison lives in the allow-list below with its reason. Logic
// only: no main-module comparison (see check-usable-reply.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// File (repo-relative, `/`-separated) to the reason its completed-terminal
// reads stay: wire contracts that must keep today's values, outcome types
// with their own capped flag, pure display, and the engine boundary.
const ALLOW_LIST = new Map([
  [
    'src/core/backends/modelapi/ModelApiHost.ts',
    "the engine's own event: the TeammateIdle child dispatch and turn-final housekeeping; capped turns keep terminal completed on the wire",
  ],
  [
    'src/core/bestOfN/bestOfNRunner.ts',
    'the attempt-level outcome with its own ceilingReached flag: a capped attempt fails and can never be taken as the winner',
  ],
  ['src/core/eval/runner.ts', "the eval driver's own outcome contract, not a turn-reply decision"],
  [
    'src/host/conversation/conversationController.ts',
    'the handoff trigger starts the brief read on completion; the brief itself is taken only through usableReply in finishHandoff',
  ],
  ['src/host/conversation/turnNotifications.ts', 'pure display: notification wording'],
  ['src/webview/state/uiState.ts', 'pure display state'],
  [
    'src/runtime/exec/runExec.ts',
    'the exec wire: result accounting, stop reasons and exit codes derive from terminal and errorKind',
  ],
  [
    'src/runtime/exec/runLedger.ts',
    "the exec ledger: priced-response evidence for the run's receipt",
  ],
  [
    'src/runtime/exec/sessionTap.ts',
    "the exec tap: message-release accounting for the run's transcript",
  ],
  ['src/runtime/exec/execProtocol.ts', 'the exec wire: the result schema and completion evidence'],
])

const ACCESSOR = 'src/core/turns/usableReply.ts'

const PATTERNS = [
  /[A-Za-z_?.]*terminal\s*[!=]==?\s*['"]completed['"]/,
  /['"]completed['"]\s*[!=]==?\s*[A-Za-z_?.]*terminal/,
  /[A-Za-z_?.]*terminal\s*[!=]==?\s*[A-Z_]*COMPLETED[A-Z_]*/,
  /[A-Z_]*COMPLETED[A-Z_]*\s*[!=]==?\s*[A-Za-z_?.]*terminal/,
]

function slash(relative) {
  // Paths compare the same on Windows checkouts and POSIX rigs.
  return relative.split(path.sep).join('/')
}

function walk(root, files) {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry)
    if (statSync(full).isDirectory()) {
      if (['node_modules', 'dist', 'temp'].includes(entry)) continue
      walk(full, files)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(full)
    }
  }
  return files
}

/**
 * Fail any completed-terminal comparison outside the accessor and the
 * allow-list. Fails on missing, empty or unreadable input: no input is
 * never a pass. Returns `{ ok: true }` or `{ ok: false, problem }`.
 */
export function checkUsableReply(root) {
  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, problem: 'usable-reply guard: pass the source root to check' }
  }
  let files
  try {
    files = walk(root, [])
  } catch {
    return { ok: false, problem: `usable-reply guard: cannot read ${root}` }
  }
  if (files.length === 0) {
    return { ok: false, problem: `usable-reply guard: empty input ${root}` }
  }
  const violations = []
  for (const file of files) {
    const relative = slash(path.relative(process.cwd(), file))
    const key = relative.startsWith('src/') ? relative : `src/${relative}`
    if (key === ACCESSOR || ALLOW_LIST.has(key)) continue
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      return { ok: false, problem: `usable-reply guard: cannot read ${file}` }
    }
    for (const [index, line] of source.split('\n').entries()) {
      if (PATTERNS.some((pattern) => pattern.test(line))) {
        violations.push(`${relative}:${String(index + 1)}: ${line.trim()}`)
      }
    }
  }
  if (violations.length > 0) {
    return {
      ok: false,
      problem: `usable-reply guard: raw completed-terminal reads outside usableReply:\n${violations.join('\n')}`,
    }
  }
  return { ok: true }
}

export function usableReplyAllowList() {
  return new Map(ALLOW_LIST)
}
