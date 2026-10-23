// M125 lane F1b (D107 §9.2-§9.4): the B1 approval floor and its
// shared conditions. A held shell action skips the reviewer and runs
// inside B1's confinement only when the floor passes (§9.3.2, which
// nothing overrides), every condition holds (§9.3.1/3/4, on a
// certified platform), and the veto race (the veto within its window,
// B1's output, both before the reviewer's verdict) is won. Anything
// else runs the reviewer exactly as today. Pure: the fence supplies
// the judgement, the tool context and the live answers; this module
// decides and names the reason in typed protocol words, never display
// text. macOS waits for Q-D107-B1-MAC, Windows is off by §9.2, and no
// platform is certified until its receipt and the harm bound land.
import type { ApprovalMode } from '../../../shared/permissionModes'
import { JUDGE_FAST_VETO_POLL_MS, JUDGE_FAST_VETO_WINDOW_MS } from '../../../shared/constants'
import type { SettledBy } from '../../backends/modelapi/permissions'
import { isErrno } from '../../fs/errno'
import type { InspectResult } from './inspectExec'
import { parseInspectCommand, type InspectCommand } from './inspectGrammar'

/** The floor's verdict words (§9.3.2), in the design's list order. */
export type B1FloorReason =
  | 'forbidRule'
  | 'askRule'
  | 'evaluator'
  | 'sudo'
  | 'packageInstall'
  | 'gitCommand'
  | 'forceFlag'
  | 'networkTool'
  | 'paidTool'
  | 'spawnTool'
  | 'mcpWrite'
  | 'confidentialNonlocal'
  | 'grammar'

/** The shared conditions' verdict words (§9.2-§9.3). */
export type B1ConditionReason =
  | 'uncertifiedPlatform'
  | 'mode'
  | 'headless'
  | 'untrustedOrigin'
  | 'untrustedWorkspace'
  | 'sessionProcess'
  | 'confinement'

export interface B1ToolContext {
  /** The call reaches the network, a paid tool, a spawn, or a writing MCP tool. */
  readonly network: boolean
  readonly paid: boolean
  readonly spawn: boolean
  readonly mcpWrite: boolean
}

export interface B1FloorContext {
  /** Which rule settled the judgement, when one did (M78). */
  readonly settledBy: SettledBy | undefined
  readonly tool: B1ToolContext
  /** A confidential workspace asking through a non-local engine. */
  readonly confidentialNonlocal: boolean
}

export type B1FloorVerdict =
  | { readonly pass: true; readonly parsed: InspectCommand; readonly canonical: string }
  | { readonly pass: false; readonly reason: B1FloorReason }

const EVALUATORS: ReadonlySet<string> = new Set(['eval', 'iex'])
const INSTALLERS: ReadonlySet<string> = new Set([
  'npm',
  'pnpm',
  'yarn',
  'pip',
  'pip3',
  'apt',
  'apt-get',
  'dnf',
  'yum',
  'pacman',
  'brew',
  'apk',
  'zypper',
])

function firstWord(line: string): string {
  const token = line.trim().split(/\s+/u, 1)[0] ?? ''
  return token.replaceAll(/^'+|'+$/gu, '')
}

function hasForceFlag(line: string): boolean {
  return line
    .trim()
    .split(/\s+/u)
    .some((token) => token === '--force' || token.startsWith('--force='))
}

function hasEncodedCommand(line: string): boolean {
  // PowerShell's spelling is case-insensitive, so the match is too.
  return line
    .trim()
    .split(/\s+/u)
    .some((token) => token.toLowerCase() === '-encodedcommand')
}

/**
The floor (§9.3.2): the line the reviewer would see, kept or refused
with its reason. The grammar (F1a) decides shell syntax, paths,
protected and private entries, secrets, programs and options; the
checks here name what the design names explicitly (rules, evaluators,
sudo, installs, git, --force, the tool context, confidential routing)
ahead of it, and anything the grammar refuses falls through as
grammar. A pass carries the parse and the canonical line the grant
and the tool record send (RVCM125F1A).
*/
export function b1Floor(
  line: string,
  context: B1FloorContext,
  platform: NodeJS.Platform = process.platform,
): B1FloorVerdict {
  if (context.settledBy === 'forbidRule') return { pass: false, reason: 'forbidRule' }
  if (context.settledBy === 'askRule') return { pass: false, reason: 'askRule' }
  const program = firstWord(line)
  if (EVALUATORS.has(program) || hasEncodedCommand(line)) {
    return { pass: false, reason: 'evaluator' }
  }
  if (program === 'sudo') return { pass: false, reason: 'sudo' }
  if (program === 'git') return { pass: false, reason: 'gitCommand' }
  if (INSTALLERS.has(program)) return { pass: false, reason: 'packageInstall' }
  if (hasForceFlag(line)) return { pass: false, reason: 'forceFlag' }
  if (context.tool.network) return { pass: false, reason: 'networkTool' }
  if (context.tool.paid) return { pass: false, reason: 'paidTool' }
  if (context.tool.spawn) return { pass: false, reason: 'spawnTool' }
  if (context.tool.mcpWrite) return { pass: false, reason: 'mcpWrite' }
  if (context.confidentialNonlocal) return { pass: false, reason: 'confidentialNonlocal' }
  const parsed = parseInspectCommand(line, platform)
  return parsed === undefined
    ? { pass: false, reason: 'grammar' }
    : { pass: true, parsed, canonical: canonicalB1Line(parsed) }
}

const BARE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/

/**
The canonical line for the grant and the tool record: the program and
the grammar's canonical operands and options. The grammar never admits
a quote inside a word, so single-quoting the words the bare spelling
cannot hold always round-trips.
*/
export function canonicalB1Line(parsed: InspectCommand): string {
  return [parsed.program, ...parsed.args.map((word) => quoteB1Word(word))].join(' ')
}

function quoteB1Word(word: string): string {
  return BARE_WORD.test(word) ? word : `'${word}'`
}

export interface B1Conditions {
  /** Auto only: Model API onRequest (M95 providers ride the same loop). */
  readonly mode: ApprovalMode
  readonly isHeadlessRun: boolean
  readonly isUntrustedOrigin: boolean
  /** Restricted Mode is an untrusted workspace: the shell asks there anyway. */
  readonly isWorkspaceTrusted: boolean
  /** A process the session started is alive (registry, or the cgroup's members). */
  readonly sessionProcessAlive: boolean
  /** The confinement passed its self-test in this session. */
  readonly confinementReady: boolean
  readonly platform: NodeJS.Platform
  /** Platforms with a receipt and a harm bound (none until both land). */
  readonly certifiedPlatforms: readonly NodeJS.Platform[]
}

export type B1ConditionVerdict =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: B1ConditionReason }

/**
The shared conditions (§9.2-§9.3.1/3/4): where B1 runs, in which
mode and company. The veto (§9.3.5) is the race, not a flag.
*/
export function b1Eligible(conditions: B1Conditions): B1ConditionVerdict {
  if (!conditions.certifiedPlatforms.includes(conditions.platform)) {
    return { eligible: false, reason: 'uncertifiedPlatform' }
  }
  if (conditions.mode !== 'onRequest') return { eligible: false, reason: 'mode' }
  if (conditions.isHeadlessRun) return { eligible: false, reason: 'headless' }
  if (conditions.isUntrustedOrigin) return { eligible: false, reason: 'untrustedOrigin' }
  if (!conditions.isWorkspaceTrusted) return { eligible: false, reason: 'untrustedWorkspace' }
  if (conditions.sessionProcessAlive) return { eligible: false, reason: 'sessionProcess' }
  return conditions.confinementReady
    ? { eligible: true }
    : { eligible: false, reason: 'confinement' }
}

/**
The veto pipeline's own numbers (§9.6's audit), when the veto ran one:
the engine that answered, its calibrated p(yes) and the bar it passed,
in permille. A veto read from M98's fence carries none — the fence
hides its engine and probabilities by contract — and the audit omits
them until a veto pipeline that exposes them lands.
*/
export interface VetoPipelineDetail {
  readonly engine: string
  readonly pYesMilli: number
  readonly thresholdMilli: number
}

export interface VetoAnswer {
  /** The judge's 7.1 answer over the command: caution reads veto. */
  readonly veto: boolean
  readonly detail?: VetoPipelineDetail | undefined
}

/** The judge fence's read side, polled until it settles or aborts. */
export interface VetoFenceReader {
  readonly read: () => 'caution' | 'none' | undefined
}

/**
Read the veto from the judge fence (§9.3.5): caution is a veto, a
settled none is a non-veto, and an abort throws so the race discards
the fast path. The race's window turns a fence that never settles
into a veto; this read never times out on its own.
*/
export async function readVetoFence(
  fence: VetoFenceReader,
  signal: AbortSignal,
  pollMs: number = JUDGE_FAST_VETO_POLL_MS,
): Promise<VetoAnswer> {
  for (;;) {
    signal.throwIfAborted()
    const outcome = fence.read()
    if (outcome === 'caution') return { veto: true }
    if (outcome === 'none') return { veto: false }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs)
    })
  }
}

/**
The race's ports, supplied by the fence. Every port honors its signal:
aborting veto or inspect discards the fast path, aborting the reviewer
cancels it at the skip. A veto ask that throws is no answer, hence a
veto; the inspect run never throws (the runner refuses instead); a
reviewer that throws on today's path propagates exactly as today.
*/
export interface ApprovalRacePorts<R> {
  readonly startReviewer: (signal: AbortSignal) => Promise<R>
  readonly askVeto: (signal: AbortSignal) => Promise<VetoAnswer>
  readonly runInspect: (signal: AbortSignal) => Promise<InspectResult>
}

export type ApprovalRaceOutcome<R> =
  | {
      readonly kind: 'skip'
      readonly stdout: string
      readonly stderr: string
      readonly exitCode: number
      readonly excluded: number
      readonly vetoLatencyMs: number
      readonly detail?: VetoPipelineDetail | undefined
    }
  | { readonly kind: 'reviewer'; readonly verdict: R }

/**
The helper's fixed program table (native/confine/MuseSparkConfine.c
program_path), mirrored for the audit's resolved executable: no PATH
search on either side, so a planted program never runs. stat runs no
program and maps to nothing. A test holds this table against the C
source so the two cannot drift.
*/
const B1_PROGRAM_PATHS: Readonly<Record<string, string>> = {
  ls: '/bin/ls',
  cat: '/bin/cat',
  head: '/usr/bin/head',
  tail: '/usr/bin/tail',
  wc: '/usr/bin/wc',
  du: '/usr/bin/du',
  grep: '/bin/grep',
  find: '/usr/bin/find',
}

/** The fixed path the helper execs for the program, if it execs one. */
export function b1ProgramPath(program: string): string | undefined {
  return B1_PROGRAM_PATHS[program]
}

/**
The resolved executable for the audit (§9.6): the fixed path through
realpath, as the helper's own system_file resolves it before execve.
A path that cannot be resolved audits as absent, never guessed. The
helper re-verifies ownership at run time; a root-level swap between
this resolution and the run is outside the threat model.
*/
export function resolveB1Executable(
  program: string,
  realpath: (filePath: string) => string,
): string | undefined {
  const fixed = b1ProgramPath(program)
  if (fixed === undefined) return undefined
  try {
    return realpath(fixed)
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    return undefined
  }
}

type Settled<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly cause: unknown }

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { status: 'fulfilled', value: await promise }
  } catch (error: unknown) {
    return { status: 'rejected', cause: error }
  }
}

/**
The hold's race (§9.3): the reviewer starts as today, and the veto
question with B1's run beside it. The fast path wins only when the
non-veto arrives inside its window and B1's output delivers, both
before the reviewer's verdict; the skip is decided at that delivery
and the cancel reaches the reviewer then. A reviewer verdict first,
a veto, a closed window, or a B1 that cannot deliver all run today's
path with no added wait, discarding the run in progress. Every port
promise is settled exactly once on every path: nothing floats.
*/
export async function raceApproval<R>(
  ports: ApprovalRacePorts<R>,
  vetoWindowMs: number = JUDGE_FAST_VETO_WINDOW_MS,
): Promise<ApprovalRaceOutcome<R>> {
  const heldAt = Date.now()
  const reviewerAbort = new AbortController()
  const vetoAbort = new AbortController()
  const inspectAbort = new AbortController()
  const reviewer = settle(ports.startReviewer(reviewerAbort.signal))
  const veto = settle(ports.askVeto(vetoAbort.signal))
  const inspect = settle(ports.runInspect(inspectAbort.signal))
  let windowId: ReturnType<typeof setTimeout> | undefined
  try {
    const windowClosed = new Promise<void>((resolve) => {
      windowId = setTimeout(resolve, vetoWindowMs)
    })
    const awaitVeto = async () => ({ kind: 'veto', settled: await veto }) as const
    const awaitReviewer = async () => ({ kind: 'reviewer', settled: await reviewer }) as const
    const awaitWindow = async () => {
      await windowClosed
      return { kind: 'timeout' } as const
    }
    const first = await Promise.race([awaitVeto(), awaitReviewer(), awaitWindow()])
    if (first.kind === 'reviewer') {
      vetoAbort.abort()
      inspectAbort.abort()
      if (first.settled.status === 'rejected') throw first.settled.cause
      return { kind: 'reviewer', verdict: first.settled.value }
    }
    const answer = first.kind === 'timeout' ? undefined : first.settled
    if (answer?.status !== 'fulfilled' || answer.value.veto) {
      inspectAbort.abort()
      const settled = await reviewer
      if (settled.status === 'rejected') throw settled.cause
      return { kind: 'reviewer', verdict: settled.value }
    }
    const vetoDetail = answer.value.detail
    const vetoLatencyMs = Date.now() - heldAt
    const awaitInspect = async () => ({ kind: 'inspect', settled: await inspect }) as const
    const second = await Promise.race([awaitInspect(), awaitReviewer()])
    if (second.kind === 'reviewer') {
      inspectAbort.abort()
      if (second.settled.status === 'rejected') throw second.settled.cause
      return { kind: 'reviewer', verdict: second.settled.value }
    }
    const delivered = second.settled
    if (delivered.status === 'rejected' || delivered.value.kind === 'refused') {
      const settled = await reviewer
      if (settled.status === 'rejected') throw settled.cause
      return { kind: 'reviewer', verdict: settled.value }
    }
    reviewerAbort.abort()
    return {
      kind: 'skip',
      stdout: delivered.value.stdout,
      stderr: delivered.value.stderr,
      exitCode: delivered.value.exitCode,
      excluded: delivered.value.excluded,
      vetoLatencyMs,
      ...(vetoDetail !== undefined && { detail: vetoDetail }),
    }
  } finally {
    if (windowId !== undefined) clearTimeout(windowId)
  }
}
