// M115w WU: the watchdog's CLI and ACP surface. One shared grammar for
// the terminal and the agent's local /watchdog: no turn, tool, backend
// request or model charge. No process, filesystem, backend or credential
// access: the entry binds the store, the signed-in client and the clock.
import { GitHubError, repositoryFromFullName, type GitHubClient } from '../../core/git/github'
import { wireWordForLog, type CoreLogger } from '../../core/logging'
import type { GitHubRepository } from '../../core/git/githubRemote'
import { decideWatchdogIssue, resolveWatchdogIssue } from '../../core/watchdog/decide'
import { pollWatchdogRepository } from '../../core/watchdog/poll'
import {
  collectTriageEvidence,
  formatTriageEvidence,
  parseTriageFindings,
  triageCharter,
  triageWatchdogIssue,
} from '../../core/watchdog/triage'
import type { WatchdogRepoData, WatchdogStore } from '../../core/watchdog/store'
import {
  watchdogVerifyEvidenceSchema,
  type WatchdogVerifyEvidence,
} from '../../core/watchdog/verify'
import { UI_TEXT, fill, plural } from '../../shared/l10n/text'
import {
  defaultWatchdogPolicy,
  watchdogApprovalSchema,
  watchdogClosePolicySchema,
  type TriageFindings,
  type WatchdogIssue as WatchdogRecord,
  type WatchdogOutcome,
  type WatchdogPolicy,
  type WatchdogVerdict,
} from '../../shared/watchdog'

/** A surface input the command refuses in fixed words, never a crash. */
export class WatchdogCommandError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WatchdogCommandError'
  }
}

export type WatchdogCommand =
  | { readonly verb: 'list' }
  | { readonly verb: 'status'; readonly repository?: string; readonly number?: string }
  | { readonly verb: 'pause' | 'resume' | 'poll'; readonly repository: string }
  | {
      readonly verb: 'policy'
      readonly repository: string
      readonly key?: string
      readonly value?: string
    }
  | { readonly verb: 'evidence'; readonly repository: string; readonly number: string }
  | {
      readonly verb: 'apply'
      readonly repository: string
      readonly number: string
      readonly json: string
    }
  | {
      readonly verb: 'decide'
      readonly repository: string
      readonly number: string
      readonly isApproved: boolean
    }
  | {
      readonly verb: 'resolve'
      readonly repository: string
      readonly number: string
      readonly evidence: string
      readonly isApproved: boolean
    }

function trailingApprove(words: readonly string[]): {
  readonly rest: readonly string[]
  readonly isApproved: boolean
} {
  return words.at(-1) === '--approve'
    ? { rest: words.slice(0, -1), isApproved: true }
    : { rest: words, isApproved: false }
}

/** Shared CLI and ACP grammar. Numbers stay words here; the run proves them. */
export function parseWatchdogCommand(argv: readonly string[]): WatchdogCommand | undefined {
  const [verb, ...rest] = argv
  switch (verb) {
    case 'list': {
      return rest.length === 0 ? { verb } : undefined
    }
    case 'status': {
      const [repository, number, ...extra] = rest
      if (extra.length > 0) return undefined
      if (repository === undefined) return { verb }
      return number === undefined ? { verb, repository } : { verb, repository, number }
    }
    case 'pause':
    case 'resume':
    case 'poll': {
      const [repository, ...extra] = rest
      return repository !== undefined && extra.length === 0 ? { verb, repository } : undefined
    }
    case 'policy': {
      const [repository, key, ...words] = rest
      if (repository === undefined) return undefined
      if (key === undefined) return { verb, repository }
      return words.length === 0 ? undefined : { verb, repository, key, value: words.join(' ') }
    }
    case 'evidence': {
      const [repository, number, ...extra] = rest
      return repository !== undefined && number !== undefined && extra.length === 0
        ? { verb, repository, number }
        : undefined
    }
    case 'apply': {
      const [repository, number, ...words] = rest
      return repository === undefined || number === undefined || words.length === 0
        ? undefined
        : { verb, repository, number, json: words.join(' ') }
    }
    case 'decide': {
      const { rest: words, isApproved } = trailingApprove(rest)
      const [repository, number, ...extra] = words
      return repository !== undefined && number !== undefined && extra.length === 0
        ? { verb, repository, number, isApproved }
        : undefined
    }
    case 'resolve': {
      const { rest: words, isApproved } = trailingApprove(rest)
      const [repository, number, ...evidence] = words
      return repository === undefined || number === undefined || evidence.length === 0
        ? undefined
        : { verb, repository, number, evidence: evidence.join(' '), isApproved }
    }
    default: {
      return undefined
    }
  }
}

export interface WatchdogSurfacePort {
  readonly store: WatchdogStore
  /** The signed-in client and its bearer; both undefined before `auth github`. */
  readonly client: GitHubClient | undefined
  readonly token: string | undefined
  readonly now: () => number
  readonly newRunId: () => string
  /** Report only (PLAN M115w acceptance 8): the steps after the acknowledgement post nothing. */
  readonly isReportOnly: boolean
}

function namedRepository(repository: string): GitHubRepository {
  const named = repositoryFromFullName(repository)
  if (named === undefined) throw new WatchdogCommandError(UI_TEXT.watchdog.cli.invalidRepository)
  return named
}

function issueNumber(word: string): number {
  const number = Number(word)
  if (!Number.isSafeInteger(number) || number < 1)
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.invalidIssue)
  return number
}

function signedClient(port: WatchdogSurfacePort): { client: GitHubClient; token: string } {
  if (port.client === undefined || port.token === undefined)
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.notSignedIn)
  return { client: port.client, token: port.token }
}

function provenFindings(json: string): TriageFindings {
  try {
    return parseTriageFindings(json)
  } catch (error: unknown) {
    throw new WatchdogCommandError(UI_TEXT.watchdog.triage.unreadable, { cause: error })
  }
}

function provenEvidence(json: string): WatchdogVerifyEvidence {
  let raw: unknown
  try {
    raw = JSON.parse(json) as unknown
  } catch (error: unknown) {
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.invalidEvidence, { cause: error })
  }
  const shaped = watchdogVerifyEvidenceSchema.safeParse(raw)
  if (!shaped.success)
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.invalidEvidence, { cause: shaped.error })
  return shaped.data
}

function outcomeText(outcome: WatchdogOutcome): string {
  switch (outcome) {
    case 'planEntry': {
      return UI_TEXT.watchdog.outcomes.planEntry
    }
    case 'fixLane': {
      return UI_TEXT.watchdog.outcomes.fixLane
    }
    case 'needsInfo':
    case 'duplicate':
    case 'alreadyFixed':
    case 'invalid':
    case 'spam': {
      const verdict: WatchdogVerdict = outcome
      return UI_TEXT.watchdog.verdicts[verdict]
    }
  }
}

function repoRow(data: WatchdogRepoData): string {
  return data.policy.paused
    ? `${data.policy.repository} · ${UI_TEXT.watchdog.cli.pausedWord}`
    : `${data.policy.repository} · ${plural(UI_TEXT.watchdog.cli.issueCount, data.issues.length)}`
}

function issueRow(record: WatchdogRecord): string {
  const state = UI_TEXT.watchdog.states[record.state]
  return record.findings === undefined
    ? `  #${String(record.issueNumber)}: ${state}`
    : `  #${String(record.issueNumber)}: ${state} · ${UI_TEXT.watchdog.verdicts[record.findings.verdict]}`
}

async function listText(port: WatchdogSurfacePort): Promise<string> {
  const repos = await port.store.list()
  return repos.length === 0
    ? UI_TEXT.watchdog.cli.empty
    : repos.map((data) => repoRow(data)).join('\n')
}

async function statusText(
  port: WatchdogSurfacePort,
  repository: string | undefined,
  number: string | undefined,
): Promise<{ ok: boolean; text: string }> {
  if (repository === undefined) return { ok: true, text: await listText(port) }
  namedRepository(repository)
  const repos = await port.store.list()
  const data = repos.find((item) => item.policy.repository === repository)
  if (data === undefined) return { ok: false, text: UI_TEXT.watchdog.cli.notWatched }
  if (number === undefined) {
    return {
      ok: true,
      text:
        data.issues.length === 0
          ? UI_TEXT.watchdog.cli.noIssues
          : [repoRow(data), ...data.issues.map((item) => issueRow(item))].join('\n'),
    }
  }
  const issue = data.issues.find((item) => item.issueNumber === issueNumber(number))
  if (issue === undefined) return { ok: false, text: UI_TEXT.watchdog.cli.unknownIssue }
  const lines = [
    `${repository}#${String(issue.issueNumber)}: ${UI_TEXT.watchdog.states[issue.state]}`,
  ]
  if (issue.findings !== undefined) {
    lines.push(
      `${UI_TEXT.watchdog.verdicts[issue.findings.verdict]} · ${issue.findings.summary}`,
      ...issue.findings.questions.map((question) => `- ${question}`),
    )
  }
  if (issue.outcome !== undefined) lines.push(outcomeText(issue.outcome))
  return { ok: true, text: lines.join('\n') }
}

async function pauseText(
  port: WatchdogSurfacePort,
  repository: string,
  isPaused: boolean,
): Promise<{ ok: boolean; text: string }> {
  namedRepository(repository)
  const repos = await port.store.list()
  if (repos.every((item) => item.policy.repository !== repository))
    return { ok: false, text: UI_TEXT.watchdog.cli.notWatched }
  const isChanged = await port.store.exclusive(repository, (data) => {
    if (data.policy.paused === isPaused) return { data, result: false }
    return {
      data: { policy: { ...data.policy, paused: isPaused }, issues: data.issues },
      result: true,
    }
  })
  if (!isChanged)
    return {
      ok: false,
      text: fill(isPaused ? UI_TEXT.watchdog.cli.alreadyPaused : UI_TEXT.watchdog.cli.notPaused, {
        repository,
      }),
    }
  return {
    ok: true,
    text: fill(isPaused ? UI_TEXT.watchdog.cli.paused : UI_TEXT.watchdog.cli.resumed, {
      repository,
    }),
  }
}

/** The policy keys a person sets by word, and the field each one is. */
const POLICY_KEYS = new Set([
  'label',
  'template',
  'watch-labels',
  'ignore-authors',
  'posts',
  'close',
])

function listWord(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(',')
}

function policyLines(policy: WatchdogPolicy): string[] {
  return [
    fill(UI_TEXT.watchdog.cli.policyHeading, { repository: policy.repository }),
    `label: ${policy.ackLabel}`,
    `template: ${policy.ackTemplate ?? 'default'}`,
    `watch-labels: ${listWord(policy.watchLabels)}`,
    `ignore-authors: ${listWord(policy.ignoreAuthors)}`,
    `posts: ${policy.postsBeyondAck}`,
    `close: ${policy.closePolicy}`,
  ]
}

function listValue(value: string): string[] {
  return value === 'none'
    ? []
    : value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
}

/** The policy with `key` set to the person's `value`, or the sentence
saying why not. The enum keys take only their own words. */
function policyWith(
  policy: WatchdogPolicy,
  key: string,
  value: string,
): { readonly policy: WatchdogPolicy } | { readonly refusal: string } {
  switch (key) {
    case 'label': {
      return { policy: { ...policy, ackLabel: value } }
    }
    case 'template': {
      const { ackTemplate: _previous, ...rest } = policy
      return { policy: value === 'default' ? rest : { ...rest, ackTemplate: value } }
    }
    case 'watch-labels': {
      return { policy: { ...policy, watchLabels: listValue(value) } }
    }
    case 'ignore-authors': {
      return { policy: { ...policy, ignoreAuthors: listValue(value) } }
    }
    case 'posts': {
      const parsed = watchdogApprovalSchema.safeParse(value)
      return parsed.success
        ? { policy: { ...policy, postsBeyondAck: parsed.data } }
        : {
            refusal: fill(UI_TEXT.watchdog.cli.policyInvalid, {
              key,
              allowed: watchdogApprovalSchema.options.join(', '),
            }),
          }
    }
    case 'close': {
      const parsed = watchdogClosePolicySchema.safeParse(value)
      return parsed.success
        ? { policy: { ...policy, closePolicy: parsed.data } }
        : {
            refusal: fill(UI_TEXT.watchdog.cli.policyInvalid, {
              key,
              allowed: watchdogClosePolicySchema.options.join(', '),
            }),
          }
    }
    default: {
      return { refusal: UI_TEXT.watchdog.cli.policyUnknownKey }
    }
  }
}

async function policyText(
  port: WatchdogSurfacePort,
  repository: string,
  key: string | undefined,
  value: string | undefined,
): Promise<{ ok: boolean; text: string }> {
  namedRepository(repository)
  if (key === undefined || value === undefined) {
    const repos = await port.store.list()
    const policy =
      repos.find((item) => item.policy.repository === repository)?.policy ??
      defaultWatchdogPolicy(repository)
    return { ok: true, text: policyLines(policy).join('\n') }
  }
  if (!POLICY_KEYS.has(key)) return { ok: false, text: UI_TEXT.watchdog.cli.policyUnknownKey }
  const refusal = await port.store.exclusive<string | undefined>(repository, (data) => {
    const changed = policyWith(data.policy, key, value)
    return 'refusal' in changed
      ? { data, result: changed.refusal }
      : { data: { policy: changed.policy, issues: data.issues }, result: undefined }
  })
  return refusal === undefined
    ? { ok: true, text: fill(UI_TEXT.watchdog.cli.policySet, { key, repository }) }
    : { ok: false, text: refusal }
}

async function pollText(
  port: WatchdogSurfacePort,
  repository: string,
): Promise<{ ok: boolean; text: string }> {
  const { client, token } = signedClient(port)
  namedRepository(repository)
  const poll = await pollWatchdogRepository(
    { client, token, store: port.store, now: port.now, newRunId: port.newRunId },
    repository,
  )
  const lines: string[] = []
  if (poll.created) lines.push(fill(UI_TEXT.watchdog.cli.watching, { repository }))
  if (poll.paused) lines.push(`${repository} · ${UI_TEXT.watchdog.cli.pausedWord}`)
  if (poll.stopped !== undefined) lines.push(poll.stopped)
  for (const row of poll.issues) {
    const note = row.note === undefined ? undefined : UI_TEXT.watchdog.poll[row.note]
    const head =
      row.state === 'skipped'
        ? `  #${String(row.number)}: ${note ?? ''}`.trimEnd()
        : `  #${String(row.number)}: ${UI_TEXT.watchdog.states[row.state]}${note === undefined ? '' : ` · ${note}`}`
    lines.push(row.overdue ? `${head} · ${UI_TEXT.watchdog.cli.overdue}` : head)
  }
  for (const failure of poll.errors)
    lines.push(
      failure.number === undefined
        ? failure.message
        : `  #${String(failure.number)}: ${failure.message}`,
    )
  if (lines.length === 0) lines.push(UI_TEXT.watchdog.cli.noIssues)
  return {
    ok: poll.stopped === undefined && poll.errors.length === 0,
    text: lines.join('\n'),
  }
}

async function trackedIssue(
  port: WatchdogSurfacePort,
  repository: string,
  number: number,
): Promise<WatchdogRecord | undefined> {
  const repos = await port.store.list()
  return repos
    .find((item) => item.policy.repository === repository)
    ?.issues.find((item) => item.issueNumber === number)
}

async function evidenceText(
  port: WatchdogSurfacePort,
  repository: string,
  word: string,
): Promise<string> {
  const { client, token } = signedClient(port)
  const named = namedRepository(repository)
  const number = issueNumber(word)
  const tracked = await trackedIssue(port, repository, number)
  if (tracked === undefined) throw new WatchdogCommandError(UI_TEXT.watchdog.cli.unknownIssue)
  const issue = await client.issue(token, named, number)
  const open = await client.listIssues(token, named)
  const evidence = await collectTriageEvidence({ client, token }, named, issue, open, [])
  return `${triageCharter()}\n\n${formatTriageEvidence(evidence)}`
}

async function applyText(
  port: WatchdogSurfacePort,
  repository: string,
  word: string,
  json: string,
): Promise<string> {
  namedRepository(repository)
  const number = issueNumber(word)
  const findings = provenFindings(json)
  const tracked = await trackedIssue(port, repository, number)
  if (tracked?.state !== 'acknowledged')
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.applyNeedsAck)
  await triageWatchdogIssue({ store: port.store, now: port.now }, repository, number, json)
  return fill(UI_TEXT.watchdog.cli.triagedAs, {
    verdict: UI_TEXT.watchdog.verdicts[findings.verdict],
  })
}

async function decideText(
  port: WatchdogSurfacePort,
  repository: string,
  word: string,
  isApproved: boolean,
): Promise<string> {
  const { client, token } = signedClient(port)
  namedRepository(repository)
  const number = issueNumber(word)
  const record = await trackedIssue(port, repository, number)
  if (record?.state !== 'triaged' || record.findings === undefined)
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.decideNeedsTriage)
  const decision = await decideWatchdogIssue(
    {
      client,
      token,
      store: port.store,
      isPostApproved: () => Promise.resolve(isApproved),
      isReportOnly: port.isReportOnly,
      now: port.now,
    },
    repository,
    number,
  )
  const lines = [fill(UI_TEXT.watchdog.cli.decided, { outcome: outcomeText(decision.outcome) })]
  if (decision.posted) lines.push(UI_TEXT.watchdog.cli.posted)
  else if (!decision.closed && decision.reason === undefined && decision.planDraft === undefined)
    lines.push(UI_TEXT.watchdog.cli.alreadyPosted)
  if (decision.closed) lines.push(UI_TEXT.watchdog.cli.closedNote)
  if (decision.reason !== undefined) lines.push(decision.reason)
  if (decision.proposedReply !== undefined)
    lines.push(UI_TEXT.watchdog.cli.proposedReply, decision.proposedReply)
  if (decision.planDraft !== undefined) lines.push(decision.planDraft)
  return lines.join('\n')
}

async function resolveText(
  port: WatchdogSurfacePort,
  repository: string,
  word: string,
  json: string,
  isApproved: boolean,
): Promise<string> {
  const { client, token } = signedClient(port)
  namedRepository(repository)
  const number = issueNumber(word)
  const evidence = provenEvidence(json)
  const record = await trackedIssue(port, repository, number)
  if (
    record?.state !== 'planned' ||
    record.findings === undefined ||
    (record.outcome !== 'planEntry' && record.outcome !== 'fixLane')
  )
    throw new WatchdogCommandError(UI_TEXT.watchdog.cli.resolveNeedsPlan)
  const resolution = await resolveWatchdogIssue(
    {
      client,
      token,
      store: port.store,
      isPostApproved: () => Promise.resolve(isApproved),
      isReportOnly: port.isReportOnly,
      now: port.now,
    },
    repository,
    number,
    evidence,
  )
  const lines: string[] = []
  if (resolution.notes !== undefined)
    lines.push(fill(UI_TEXT.watchdog.cli.notVerified, { notes: resolution.notes }))
  if (resolution.posted) lines.push(UI_TEXT.watchdog.cli.posted)
  else if (!resolution.closed && resolution.notes === undefined && resolution.reason === undefined)
    lines.push(UI_TEXT.watchdog.cli.alreadyPosted)
  if (resolution.closed) lines.push(UI_TEXT.watchdog.cli.closedNote)
  if (resolution.reason !== undefined) lines.push(resolution.reason)
  if (resolution.proposedReply !== undefined)
    lines.push(UI_TEXT.watchdog.cli.proposedReply, resolution.proposedReply)
  return lines.join('\n')
}

/** Runs one parsed command. GitHub's own refusal and the surface's fixed
sentences answer; anything else keeps its kind for the caller to report. */
export async function runWatchdogCommand(
  command: WatchdogCommand,
  port: WatchdogSurfacePort | undefined,
): Promise<{ readonly ok: boolean; readonly text: string }> {
  if (port === undefined) return { ok: false, text: UI_TEXT.watchdog.cli.unavailable }
  try {
    switch (command.verb) {
      case 'list': {
        return { ok: true, text: await listText(port) }
      }
      case 'status': {
        return await statusText(port, command.repository, command.number)
      }
      case 'pause': {
        return await pauseText(port, command.repository, true)
      }
      case 'resume': {
        return await pauseText(port, command.repository, false)
      }
      case 'poll': {
        return await pollText(port, command.repository)
      }
      case 'policy': {
        return await policyText(port, command.repository, command.key, command.value)
      }
      case 'evidence': {
        return { ok: true, text: await evidenceText(port, command.repository, command.number) }
      }
      case 'apply': {
        return {
          ok: true,
          text: await applyText(port, command.repository, command.number, command.json),
        }
      }
      case 'decide': {
        return {
          ok: true,
          text: await decideText(port, command.repository, command.number, command.isApproved),
        }
      }
      case 'resolve': {
        return {
          ok: true,
          text: await resolveText(
            port,
            command.repository,
            command.number,
            command.evidence,
            command.isApproved,
          ),
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof GitHubError) return { ok: false, text: error.message }
    if (error instanceof WatchdogCommandError) return { ok: false, text: error.message }
    throw error
  }
}

/** The standalone CLI entry binds a trusted local port and its output
streams. A failed command reports failure on stderr and exits 1; bad
syntax exits 2. The record keeps the failure's kind; the person gets
the fixed sentence. */
export async function runWatchdogCli(
  argv: readonly string[],
  deps: {
    readonly port: WatchdogSurfacePort | undefined
    readonly writeStdout: (text: string) => void
    readonly printError: (text: string) => void
    readonly log: CoreLogger
  },
): Promise<number> {
  const command = parseWatchdogCommand(argv)
  if (command === undefined) {
    deps.printError(UI_TEXT.watchdog.cli.usage)
    return 2
  }
  try {
    const result = await runWatchdogCommand(command, deps.port)
    if (result.ok) {
      deps.writeStdout(result.text)
      return 0
    }
    deps.printError(result.text)
    return 1
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    deps.log.warn(`The watchdog command failed: ${wireWordForLog(error.name)}`)
    deps.printError(UI_TEXT.watchdog.cli.commandFailed)
    return 1
  }
}
