// The capped-turn rule (tool rounds, round 7): no consumer reads a turn's
// reply as a result through the raw completed terminal. The one accessor is
// `usableReply` (src/core/turns/usableReply.ts); every other completed-
// terminal comparison lives in the allow-list below with its reason. Logic
// only: no main-module comparison (see check-usable-reply.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Function (`file:function`, repo-relative `/`-separated) to the reason its
// completed-terminal reads stay. Functions, not files: a new reader in an
// allow-listed file still fails until it has its own reason. Each reason
// was read at the site: wire contracts that must keep today's values,
// outcome types with their own capped flag or no reply to gate, pure
// display of the verbatim wire terminal (PLAN.md D36), and the engine
// boundary. Reads that collect per-item texts stay only because the
// decision over them goes through `usableReply` at the cited call.
const ALLOW_LIST = new Map([
  // The engine's own responses: the wire response's status feeds the
  // overflow classifier, and finalization drops undelivered media when the
  // turn did not complete. Neither takes the reply as an answer.
  [
    'src/core/backends/modelapi/ModelApiHost.ts:streamAttempt',
    "the wire response's own status feeds the overflow classifier's completed flag",
  ],
  [
    'src/core/backends/modelapi/ModelApiHost.ts:runTurn',
    'turn-final housekeeping: undelivered media drops when the turn did not complete',
  ],
  // The engine's own TeammateIdle child dispatch on turnCompleted. A capped
  // turn ended (it is idle); the reply is never taken here.
  [
    'src/core/backends/modelapi/ModelApiHost.ts:childEvent',
    "the engine's own event: the TeammateIdle child dispatch on turn completion",
  ],
  // The model-written todo list merge and the compaction file-set scan read
  // todo and toolCall ITEM statuses, never a turn reply.
  [
    'src/core/backends/modelapi/ModelApiHost.ts:writeTodos',
    'the todo-list merge reads todo item statuses',
  ],
  [
    'src/core/backends/modelapi/ModelApiHost.ts:compactionFiles',
    'the compaction file-set scan reads transcript toolCall item statuses',
  ],
  [
    'src/core/backends/modelapi/ModelApiHost.ts:compactedThrough',
    'the last completed compaction row bounds compaction in transcript order',
  ],
  // The judge stream's wire response status proves a response exists; an
  // incomplete stream throws instead of judging, and the collected text
  // returns only through usableReply (src/host/judge/museCodeSameJudge.ts).
  [
    'src/core/backends/modelapi/ModelApiHost.ts:judgeConnection',
    'the judge stream completeness check: without a completed response it throws instead of judging',
  ],
  // The codecs translate the wire's own statuses into stream events and
  // enforce the hosted-search invariant; none takes a reply as an answer.
  [
    'src/core/backends/modelapi/codecs/anthropic.ts:decodeAnthropicStream',
    "the streamed stop status becomes the response's completed/incomplete event",
  ],
  [
    'src/core/backends/modelapi/codecs/chat.ts:encodeChatRequest',
    'the hosted-search invariant: an uncompleted search item never reaches a BYO model',
  ],
  [
    'src/core/backends/modelapi/codecs/ollama.ts:decodeOllamaStream',
    "the streamed status becomes the response's completed/incomplete/failed event",
  ],
  // Compaction debt sampling watches todo item statuses, never a reply.
  [
    'src/core/backends/modelapi/autoCompact.ts:newUserTask',
    'compaction sampling resets only once every todo item is completed',
  ],
  [
    'src/core/backends/modelapi/autoCompact.ts:noteTodos',
    'compaction sampling counts newly completed todo items',
  ],
  // The eval driver's own outcome contract (EvalTurnOutcome) carries no
  // reply and no errorKind, so usableReply cannot apply; a finished turn
  // counts finished by design of the measurement. The recall read is an
  // ITEM status (completed recall_output calls).
  [
    'src/core/eval/runner.ts:turnFailures',
    "the eval driver's own outcome contract, not a turn-reply decision",
  ],
  [
    'src/core/eval/driver.ts:runEvalTurn',
    'completed recall_output item statuses choose the recalled outputs',
  ],
  // The attempt-level outcome with its own ceilingReached flag: a capped
  // attempt fails and can never be taken as the winner. The take gate
  // re-checks the attempt record, and the dialog only offers completed
  // attempt records for compare and take.
  [
    'src/core/bestOfN/bestOfNRunner.ts:onAttemptEvent',
    'the attempt-level outcome with its own ceilingReached flag: a capped attempt fails and can never be taken as the winner',
  ],
  [
    'src/core/bestOfN/bestOfNRunner.ts:take',
    'the take-branch gate re-checks the attempt record before landing anything',
  ],
  [
    'src/webview/components/BestOfNDialog.tsx:AttemptRow',
    'the take button shows only for a completed attempt record',
  ],
  [
    'src/webview/components/BestOfNDialog.tsx:BestOfNDialog',
    'the compare dialog lists completed attempt records',
  ],
  // Agent evidence classifies unfinished TODO items, never a reply.
  [
    'src/core/agent/agentEvidence.ts:finishedAgentEvidence',
    'evidence classifies unfinished todo items for the final check',
  ],
  // The playbook review collects per-item texts; the decision over them
  // goes through usableReply in settle.
  [
    'src/core/orchestration/panelPlaybook.ts:observe',
    'collects per-item review texts; settle consumes them only through usableReply',
  ],
  // The handoff trigger starts the brief read on completion; the brief
  // itself is taken only through usableReply in finishHandoff. The message
  // display hold reads an ITEM status for a display-only rewrite.
  [
    'src/host/conversation/conversationController.ts:track',
    'the handoff trigger starts the brief read on completion; the brief itself is taken only through usableReply in finishHandoff',
  ],
  [
    'src/host/conversation/conversationController.ts:holdForMessageDisplay',
    'an item display gate: the message-display hold reads an item status',
  ],
  // Verbatim wire-terminal display (PLAN.md D36): completed — including a
  // capped turn, which the wire types completed — reads "finished". The
  // limit detail travels in the chat notice, not the terminal.
  [
    'src/host/conversation/turnNotifications.ts:endedMessage',
    'pure display: the background notice renders the wire terminal verbatim, capped turns included',
  ],
  [
    'src/webview/state/uiState.ts:turnAnnouncement',
    'pure display: the live-region announcement renders the wire terminal verbatim, capped turns included',
  ],
  [
    'src/webview/state/uiState.ts:completeTurn',
    'pure display state: plan-dismissal and completion bookkeeping keyed off the wire terminal',
  ],
  // Side-channel collectors: per-item texts gathered for the reviewer, the
  // hook models and the same-model judge. Each map is read only through
  // usableReply at the cited call, so a capped turn's text never decides.
  [
    'src/host/review/museCodeReviewer.ts:hear',
    'collects per-item review texts; the approval reads them only through usableReply',
  ],
  [
    'src/host/review/museCodeHookModels.ts:hear',
    'collects per-item hook texts; the finish reads them only through usableReply',
  ],
  [
    'src/host/judge/museCodeSameJudge.ts:trackBatchTurns',
    'collects per-item judge texts; the verdict reads them only through usableReply',
  ],
  // An MSP login method name, not a terminal: the sign-in flow answers only
  // its own completion notification.
  [
    'src/host/auth/deviceSignIn.ts:runDeviceSignIn',
    'the sign-in flow filters its own login-completed notification method',
  ],
  // The Muse Code session-deletion handshake reads MSP lifecycle outcomes
  // (a deleted session's own terminal), never a turn reply.
  [
    'src/core/backends/musecode/MuseCodeHost.ts:dispatchHostEvent',
    'a deleted session disposes its record once deletion completes',
  ],
  [
    'src/core/backends/musecode/MuseCodeHost.ts:onTerminal',
    'the deletion handshake validates the completed-or-failed terminal event',
  ],
  // Transcript export suffixes an item with its own status, never a reply.
  [
    'src/core/export/transcriptMarkdown.ts:statusSuffix',
    'export suffixes an item with its own status',
  ],
  // GitHub check-run statuses tallied for the checks summary, never a reply.
  ['src/core/git/github.ts:summarizeChecks', 'the checks summary tallies check-run statuses'],
  // A pull-request worktree checkout reads its own settlement state, never
  // a turn reply.
  [
    'src/runtime/panel/pullRequests/checkout.ts:checkOutReserved',
    'the checkout settlement state decides whether the made folder stays',
  ],
  // The exec wire: per-response receipt evidence, result accounting, stop
  // reasons and exit codes derive from terminal and errorKind. The wire
  // keeps `completed` with `max_turn_requests` for a capped turn; the
  // module-scope entries are the zod refinements over the receipt and
  // result schemas (a future top-level reader lands here too, and must
  // earn its own function entry — see the certification's residual).
  [
    'src/runtime/exec/runLedger.ts:settleResponse',
    "the exec ledger: priced-response evidence for the run's receipt",
  ],
  [
    'src/runtime/exec/sessionTap.ts:releasedMessages',
    "the exec tap: message-release accounting for the run's transcript",
  ],
  [
    'src/runtime/exec/runExec.ts:makeResult',
    'the exec wire: the result, stop reason, error and exit code derive from terminal and errorKind',
  ],
  [
    'src/runtime/exec/execProtocol.ts:hasCompletionEvidence',
    'the exec wire: the result schema and completion evidence',
  ],
  [
    'src/runtime/exec/execProtocol.ts:isBackendAccountingValid',
    'the exec wire: backend accounting validity for a completed result',
  ],
  [
    'src/runtime/exec/execProtocol.ts:<top>',
    'the exec wire: the module-scope zod refinements over the receipt and result schemas',
  ],
  [
    'src/runtime/exec/execClient.ts:createExecClient',
    "the exec client's ACP update handler tracks completed tool calls' file paths",
  ],
  [
    'src/runtime/exec/execOutput.ts:finishOnce',
    'egress redaction answers the schema only for a completed result',
  ],
  // The headless ledger settles the priced cost only for a completed
  // response with usage; anything else keeps its reservation.
  [
    'src/runtime/runtimeAccountingEntry.ts:settle',
    'the run ledger settles the priced cost only for a completed priced response',
  ],
  // Tool and step rows paint dots, counts and badges from item statuses.
  [
    'src/webview/components/ToolRow.tsx:ToolRowView',
    'tool rows show fetched output and images for completed tool entries',
  ],
  [
    'src/webview/components/ToolBodies.tsx:ScheduleBody',
    'the schedule body reads a tool entry status for the empty-jobs line',
  ],
  [
    'src/webview/components/TodoPanel.tsx:TodoPanel',
    'the todo progress count reads todo item statuses',
  ],
  [
    'src/webview/components/AgentMapContent.tsx:statusClassOf',
    'the agent map paints dots from agent statuses',
  ],
  [
    'src/webview/components/WorkflowRun.tsx:runDot',
    'the workflow run paints dots from run statuses',
  ],
  [
    'src/webview/components/WorkflowRun.tsx:agentDot',
    'the workflow run paints dots from agent statuses and terminals',
  ],
  [
    'src/webview/state/uiState.ts:hasLandedEdits',
    'review, revert and rewind cover rows whose edits are on disk',
  ],
  [
    'src/webview/state/uiState.ts:isFailedStatus',
    'tool rows show the failure style unless running, done or cut off',
  ],
  [
    'src/webview/state/uiState.ts:stampCompletion',
    'completion stamps cover rows with landed edits',
  ],
  [
    'src/webview/stepSummary.ts:isFailedStep',
    'step rows show the failure dot for unfinished tool steps',
  ],
  ['src/webview/toolStatus.ts:statusDotClass', 'tool rows paint dots from tool statuses'],
  // The usage panel's own export/delete message outcome, not a turn.
  [
    'src/webview/usage/UsageApp.tsx:receive',
    'the usage panel notices its own export/delete message outcome',
  ],
])

const ACCESSOR = 'src/core/turns/usableReply.ts'

// A completed value on either side of a comparison: the `'completed'`
// string or a SCREAMING name containing COMPLETED (COMPLETED, TERMINAL_
// COMPLETED, ...). Either operand may be any expression, not only a name
// containing `terminal`: `outcome === 'completed'` reads the same decision.
// Operands stay on one line (the operator may sit on the next).
const COMPLETED_VALUE = String.raw`(?:['"]completed['"]|[\w$]*COMPLETED[\w$]*)`
// The value is rare and the operator sits beside it, so the scan finds
// value-plus-operator pairs first and only then reads the other operand
// from a bounded window. Scanning every position for a lazy operand
// instead turns thousand-space blanked runs into multi-second files.
const VALUE_OP = new RegExp(
  String.raw`(${COMPLETED_VALUE})\s*(!==?|===?)|(!==?|===?)\s*(${COMPLETED_VALUE})`,
  'gd',
)
const OPERAND_WINDOW = 320

/** The comparison's other operand after an operator, with its coordinates. */
function operandAfter(stripped, opEnd) {
  const firstLine = stripped.slice(opEnd, opEnd + OPERAND_WINDOW).split('\n', 1)[0]
  const raw = firstLine.split(/[;{}()]/, 1)[0]
  const text = raw.trim()
  if (text === '' || text.length > OPERAND_WINDOW - 20) return
  const start = opEnd + (raw.length - raw.trimStart().length)
  return { text, start, end: start + text.length }
}

/** The comparison's other operand beside an operator hit. */
function otherOperand(stripped, isValueFirst, opSpan) {
  if (opSpan.length !== 2) return
  return isValueFirst ? operandAfter(stripped, opSpan[1]) : operandBefore(stripped, opSpan[0])
}

/** The comparison's other operand before an operator, with its coordinates. */
function operandBefore(stripped, opStart) {
  const segments = stripped.slice(Math.max(0, opStart - OPERAND_WINDOW), opStart).split('\n')
  const raw = segments
    .at(-1)
    .split(/[;{}()]/)
    .pop()
  const text = raw.trim()
  if (text === '' || text.length > OPERAND_WINDOW - 20) return
  const end = opStart - (raw.length - raw.trimEnd().length)
  return { text, start: end - text.length, end }
}
// `switch` on a terminal: the discriminant names a terminal whatever the
// case labels read.
const SWITCH_TERMINAL = /switch\s*\(([^()]*\.?\s*terminal[A-Za-z_$]*)[^()]*\)/gi

/** Source with comments and string/number literals blanked (length kept). */
function blanked(source) {
  const out = source.split('')
  let i = 0
  let isInLineComment = false
  let isInBlockComment = false
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (isInLineComment) {
      if (source[i] === '\n') isInLineComment = false
      else out[i] = ' '
      i += 1
    } else if (isInBlockComment) {
      if (two === '*/') {
        out[i] = ' '
        out[i + 1] = ' '
        isInBlockComment = false
        i += 2
      } else {
        if (source[i] !== '\n') out[i] = ' '
        i += 1
      }
    } else if (two === '//') {
      isInLineComment = true
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
    } else if (two === '/*') {
      isInBlockComment = true
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
    } else if (['"', "'", '`'].includes(source[i])) {
      // The completed literal stays readable so comparisons against it
      // match; every other string blanks (message text mentioning
      // "completed" is not a read).
      const quote = source[i]
      let end = i + 1
      while (end < source.length && source[end] !== quote && source[end] !== '\n') {
        end += source[end] === '\\' ? 2 : 1
      }
      const isCompleted = source.slice(i + 1, end) === 'completed' && source[end] === quote
      if (!isCompleted) {
        for (let j = i; j <= Math.min(end, source.length - 1); j += 1) {
          if (out[j] !== '\n') out[j] = ' '
        }
      }
      i = Math.min(end + 1, source.length)
    } else {
      i += 1
    }
  }
  return out.join('')
}

/** Words that open a paren or brace without naming a function. */
const NON_FUNCTION_NAMES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'return',
  'throw',
  'typeof',
  'new',
  'delete',
  'void',
  'await',
  'yield',
  'else',
  'do',
])

/** A name that never owns a read: keywords, or nothing found. */
function cleanName(name) {
  return name !== null && name !== undefined && !NON_FUNCTION_NAMES.has(name) ? name : null
}

/** The nearest named frame's name: an unnamed block (an `if`, a literal, a callback without a name) belongs to the function around it. */
function nearestNamed(stack) {
  for (let depthIndex = stack.length - 1; depthIndex >= 0; depthIndex -= 1) {
    if (stack[depthIndex].name !== null && stack[depthIndex].name !== undefined) {
      return stack[depthIndex].name
    }
  }
  return '<top>'
}

/**
 * One source character through the depth tracker. The dispatch switch
 * lives here rather than in the line loop, so its breaks end the switch
 * instead of a nested loop.
 */
function trackChar(state, line, charIndex) {
  const ch = line[charIndex]
  switch (ch) {
    case '(': {
      state.parenDepth += 1
      break
    }
    case ')': {
      state.parenDepth = Math.max(0, state.parenDepth - 1)
      if (state.pendingSignature !== null && state.parenDepth === state.pendingSignature.paren) {
        // The paren that opened at the signature's depth just closed. A
        // declaration continues with a body brace, a return annotation,
        // or a braced arrow body below; an expression-bodied arrow or
        // anything else closed a call, so the parking was a mistake
        // (this tree omits semicolons, so `;` alone cannot clear it). A
        // function TYPE arrow (`(): void` inside an annotation) sits
        // inside braces the signature opened: it neither continues nor
        // ends the declaration.
        const rest = line.slice(charIndex + 1)
        const isTypeArrow = state.depth > state.pendingSignature.brace && /^\s*=>/.test(rest)
        if (!isTypeArrow && !/^\s*([:{]|=>\s*(\{|$))/.test(rest)) state.pendingSignature = null
      }
      break
    }
    case ';': {
      // A `;` inside the signature's own parens separates type members
      // (`{ readonly name: string; ... }`), not statements: only a `;`
      // back at the signature's depth ends the statement. A call's own
      // `)` already cleared it through the rule above.
      if (state.pendingSignature !== null && state.parenDepth <= state.pendingSignature.paren) {
        state.pendingSignature = null
      }
      break
    }
    case '{': {
      state.depth += 1
      let name = null
      if (state.openings.has(charIndex)) name = state.openings.get(charIndex)
      else if (
        state.pendingSignature !== null &&
        state.parenDepth === state.pendingSignature.paren
      ) {
        // A `{` opening a multiline annotated type (`): {`) is not the
        // body: the pending name stays for the body's own brace. A type
        // name between the colon and the brace (`): boolean {`) IS the
        // body.
        const sinceParen = line.slice(0, charIndex).split(')').at(-1) ?? ''
        if (!/:\s*$/.test(sinceParen)) {
          name = state.pendingSignature.name
          state.pendingSignature = null
        }
      }
      state.stack.push({ name, depth: state.depth })
      break
    }
    case '}': {
      state.stack.pop()
      state.depth = Math.max(0, state.depth - 1)
      break
    }
    default: {
      break
    }
  }
}

/** Nearest enclosing function name per line (1-based), via brace depth. */
function functionAtLines(stripped) {
  const lines = stripped.split('\n')
  const names = lines.map(() => '<top>')
  const stack = []
  // A return annotation holds one brace level (`: { ... }`), so an object
  // return type on one line still names its function.
  const annotation = String.raw`(?::\s*(?:[^{};]|\{[^{}]*\})+)?`
  const fnStart = new RegExp(
    String.raw`(?:function\s+([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*` +
      annotation +
      String.raw`\{|([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{|([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:^|[\s;:,({])(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*` +
      annotation +
      String.raw`\{)`,
    'g',
  )
  let depth = 0
  // Parens pair outside strings and comments (both blanked), so a brace
  // seen while deeper than a signature's start is signature noise.
  let parenDepth = 0
  // A `name(` whose signature spans lines owns its body brace: the first
  // `{` back at the signature's paren depth. A `name = (` arrow parks the
  // same way and survives its `=>`; an expression-bodied arrow never
  // parks (its parens close on the line), so no later block is stolen.
  // A `;` ends the statement, so a call mistaken for a signature never
  // owns a later block.
  let pendingSignature = null
  const sigStart =
    /(?:function\s+([A-Za-z_$][\w$]*)\([^()]*$|([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^()]*$|(?:^|[\s;:,({])(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*$)/
  for (const [index, line] of lines.entries()) {
    const parenBase = parenDepth
    // Every pattern below needs `(`, `{` or `=` on the line, and only
    // `(){};` change depth: a line without any of them is provably a
    // no-op, so the scan skips it (blanked comment and string runs are
    // the common case). The owner still resolves every line.
    const hasDefinition = /[({=]/.test(line)
    const openings = new Map()
    if (hasDefinition) {
      fnStart.lastIndex = 0
      // Char index of each opener on this line to the function it opens
      // (null: a keyword or literal block). Signature braces never appear
      // here: every alternative ends at its own opening brace.
      let match = fnStart.exec(line)
      while (match !== null) {
        const name = match[1] ?? match[2] ?? match[3] ?? match[4] ?? null
        // A same-line body brace always wins, including an arrow's own, and
        // resolves any parking under the same name.
        if (match[3] === undefined) {
          openings.set(match.index + match[0].length - 1, cleanName(name))
          if (pendingSignature?.name === name) pendingSignature = null
        } else if (pendingSignature === null) {
          // A pending arrow body (`name = (...) =>` with the brace below)
          // parks like a signature.
          const parked = cleanName(name)
          if (parked !== null) pendingSignature = { name: parked, paren: parenBase, brace: depth }
        }
        match = fnStart.exec(line)
      }
      sigStart.lastIndex = 0
      const sig = sigStart.exec(line)
      if (sig !== null) {
        const name = cleanName(sig[1] ?? sig[2] ?? sig[3])
        // A keyword never parks: it must not block a real signature below.
        // A `function` start always wins: only a declaration can follow its
        // own header, so it clears a stale call parked without a semicolon.
        if (name !== null && (pendingSignature === null || sig[1] !== undefined)) {
          pendingSignature = { name, paren: parenBase, brace: depth }
        }
      }
    }
    if (/[(){};]/.test(line)) {
      const state = { depth, parenDepth, pendingSignature, stack, openings }
      for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
        trackChar(state, line, charIndex)
      }
      depth = state.depth
      parenDepth = state.parenDepth
      pendingSignature = state.pendingSignature
    }
    names[index] = nearestNamed(stack)
  }
  return names
}

function lineOf(source, at) {
  return source.slice(0, at).split('\n').length
}

function slash(relative) {
  // Paths compare the same on Windows checkouts and POSIX rigs.
  return relative.split(path.sep).join('/')
}

function walk(root, files) {
  const stat = statSync(root)
  if (!stat.isDirectory()) {
    // A single file checks itself: the scripts accept a file as readily as
    // a root, and missing input still fails in checkUsableReply.
    if (root.endsWith('.ts') || root.endsWith('.tsx')) files.push(root)
    return files
  }
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
    if (key === ACCESSOR) continue
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      return { ok: false, problem: `usable-reply guard: cannot read ${file}` }
    }
    // Parse, don't grep: comments and strings blank out (the completed
    // literal stays), so a comparison of any name against the completed
    // value, a switch on a terminal, and a comparison split over lines
    // all match — on the whole source, not one line at a time.
    const stripped = blanked(source)
    const owners = functionAtLines(stripped)
    const seen = new Set()
    const report = (at, text) => {
      const line = lineOf(stripped, at)
      const owner = owners[line - 1] ?? '<top>'
      if (ALLOW_LIST.has(`${key}:${owner}`)) return
      const id = `${line}:${owner}`
      if (seen.has(id)) return
      seen.add(id)
      violations.push(`${relative}:${String(line)} (${owner}): ${text}`)
    }
    VALUE_OP.lastIndex = 0
    let hit = VALUE_OP.exec(stripped)
    while (hit !== null) {
      // Groups 1-2 are value-then-operator; groups 3-4 operator-then-value.
      const isValueFirst = hit[1] !== undefined
      const spans = hit.indices ?? []
      const opSpan = spans[isValueFirst ? 2 : 3] ?? []
      const valueSpan = spans[isValueFirst ? 1 : 4] ?? []
      const operand = otherOperand(stripped, isValueFirst, opSpan)
      if (operand !== undefined && valueSpan.length === 2) {
        const from = Math.min(valueSpan[0], operand.start)
        const to = Math.max(valueSpan[1], operand.end)
        const text = source.slice(from, to).replaceAll(/\s+/g, ' ').trim().slice(0, 120)
        report(hit.index, text)
      }
      hit = VALUE_OP.exec(stripped)
    }
    SWITCH_TERMINAL.lastIndex = 0
    let switched = SWITCH_TERMINAL.exec(stripped)
    while (switched !== null) {
      report(switched.index, `switch (${switched[1].trim().slice(0, 80)})`)
      switched = SWITCH_TERMINAL.exec(stripped)
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
