import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { fill, formatBytes, formatDateTime } from '../../../shared/l10n/text'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'
import type { NodeAudit } from '../../../shared/node'

type AuditFilter = 'all' | 'signin' | 'enroll' | 'terminal' | 'key' | 'node' | 'git' | 'approval'

const FILTER_IDS: readonly AuditFilter[] = [
  'all',
  'signin',
  'enroll',
  'terminal',
  'key',
  'node',
  'git',
  'approval',
]

/** Read at render, never at module load, so the installed language shows. */
function filterLabel(filter: AuditFilter): string {
  if (filter === 'all') return UI_TEXT.nodeAudit.filterAll
  if (filter === 'signin') return UI_TEXT.nodeAudit.filterSignin
  if (filter === 'enroll') return UI_TEXT.nodeAudit.filterSignup
  if (filter === 'terminal') return UI_TEXT.nodeAudit.filterTerminal
  if (filter === 'key') return UI_TEXT.nodeAudit.filterKeys
  if (filter === 'node') return UI_TEXT.nodeAudit.filterNode
  return filter === 'git' ? UI_TEXT.nodeAudit.filterGit : UI_TEXT.nodeAudit.filterApproval
}

/** Verifications read with the sign-ins: both are the owner proving who
they are. Enrollments keep their own filter, out of the sign-in stream. */
function isShownByFilter(entry: NodeAudit, filter: AuditFilter): boolean {
  switch (filter) {
    case 'all': {
      return true
    }
    case 'signin': {
      return entry.kind === 'stepUp' || (entry.kind === 'signin' && entry.action !== 'enroll')
    }
    case 'enroll': {
      return entry.kind === 'signin' && entry.action === 'enroll'
    }
    default: {
      return entry.kind === filter
    }
  }
}

function kindWord(entry: NodeAudit): string {
  switch (entry.kind) {
    case 'signin': {
      return entry.action === 'enroll'
        ? UI_TEXT.nodeAudit.filterSignup
        : UI_TEXT.nodeAudit.filterSignin
    }
    case 'stepUp': {
      return UI_TEXT.nodeAudit.kindStepUp
    }
    case 'terminal': {
      return UI_TEXT.nodeAudit.filterTerminal
    }
    case 'key': {
      return UI_TEXT.nodeAudit.filterKeys
    }
    case 'node': {
      return UI_TEXT.nodeAudit.filterNode
    }
    case 'git': {
      return UI_TEXT.nodeAudit.filterGit
    }
    default: {
      return UI_TEXT.nodeAudit.filterApproval
    }
  }
}

function outcomeWord(outcome: NodeAudit['outcome']): string {
  // Allowed and verified proofs are approvals in effect; every other
  // outcome refused the action.
  return outcome === 'allowed' || outcome === 'verified'
    ? UI_TEXT.nodeAudit.allowed
    : UI_TEXT.nodeAudit.refused
}

function signinWord(action: 'enroll' | 'signin' | 'signout' | 'lockout'): string {
  switch (action) {
    case 'enroll': {
      return UI_TEXT.nodeAudit.signinEnroll
    }
    case 'signin': {
      return UI_TEXT.nodeAudit.signinSignin
    }
    case 'signout': {
      return UI_TEXT.nodeAudit.signinSignout
    }
    default: {
      return UI_TEXT.nodeAudit.signinLockout
    }
  }
}

function keyWord(action: 'set' | 'unlock' | 'use' | 'seal'): string {
  switch (action) {
    case 'set': {
      return UI_TEXT.nodeAudit.keySet
    }
    case 'unlock': {
      return UI_TEXT.nodeAudit.keyUnlock
    }
    case 'use': {
      return UI_TEXT.nodeAudit.keyUse
    }
    default: {
      return UI_TEXT.nodeAudit.keySeal
    }
  }
}

function nodeWord(action: 'stop' | 'lock' | 'unlock' | 'wipe'): string {
  switch (action) {
    case 'stop': {
      return UI_TEXT.nodeLabels.stopAll
    }
    case 'lock': {
      return UI_TEXT.nodeLabels.lock
    }
    case 'unlock': {
      return UI_TEXT.nodeLabels.unlock
    }
    default: {
      return UI_TEXT.nodeLabels.wipe
    }
  }
}

function gitWord(action: 'stage' | 'commit' | 'branch' | 'fetch' | 'pull' | 'push'): string {
  switch (action) {
    case 'stage': {
      return UI_TEXT.nodeAudit.gitStage
    }
    case 'commit': {
      return UI_TEXT.nodeAudit.gitCommit
    }
    case 'branch': {
      return UI_TEXT.nodeAudit.gitBranch
    }
    case 'fetch': {
      return UI_TEXT.nodeAudit.gitFetch
    }
    case 'pull': {
      return UI_TEXT.nodeAudit.gitPull
    }
    default: {
      return UI_TEXT.nodeAudit.gitPush
    }
  }
}

function AuditEntry({ entry }: { readonly entry: NodeAudit }) {
  return (
    <li>
      {formatDateTime(entry.time)} {kindWord(entry)} {outcomeWord(entry.outcome)}{' '}
      <EntryDetail entry={entry} />
    </li>
  )
}

function EntryDetail({ entry }: { readonly entry: NodeAudit }) {
  if (entry.kind === 'signin')
    return (
      <>
        {signinWord(entry.action)} <code>{entry.credentialIdHash}</code>
      </>
    )
  if (entry.kind === 'stepUp')
    return (
      <>
        <code>{entry.actionDigest}</code>
      </>
    )
  if (entry.kind === 'terminal')
    return (
      <>
        <code>{entry.terminalId}</code>{' '}
        {entry.phase === 'start' ? UI_TEXT.nodeAudit.terminalStart : UI_TEXT.nodeAudit.terminalEnd}{' '}
        {entry.source === 'person'
          ? UI_TEXT.nodeLabels.terminalPerson
          : UI_TEXT.nodeLabels.terminalModel}{' '}
        {fill(UI_TEXT.nodeAudit.terminalSizes, {
          input: formatBytes(entry.inputBytes),
          output: formatBytes(entry.outputBytes),
        })}
      </>
    )
  if (entry.kind === 'key')
    return (
      <>
        {keyWord(entry.action)}{' '}
        {entry.keyKind === 'provider' ? UI_TEXT.nodeAudit.keyProvider : UI_TEXT.nodeAudit.keyDeploy}
      </>
    )
  if (entry.kind === 'node') return <>{nodeWord(entry.action)}</>
  if (entry.kind === 'git')
    return (
      <>
        {gitWord(entry.action)} <code>{entry.workspaceId}</code> <code>{entry.actionDigest}</code>
      </>
    )
  return (
    <>
      <code>{entry.requestId}</code> <code>{entry.actionDigest}</code>{' '}
      {entry.paid ? UI_TEXT.nodeAudit.approvalPaid : undefined}
    </>
  )
}

export function AuditPage({
  port,
  run,
  busy,
}: {
  readonly port: NodeMethodPort
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}) {
  const [entries, setEntries] = useState<readonly NodeAudit[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<AuditFilter>('all')
  const load = useCallback(
    async (signal: AbortSignal, at: string | null) => {
      const page: NodeMethodResult<'node/audit/list'> = await port.request(
        'node/audit/list',
        { cursor: at },
        signal,
      )
      if (signal.aborted) return
      // The server restarts an unknown cursor from the newest entries, so a
      // pruned trail re-reads cleanly; the page keeps every entry it holds
      // and appends only entries it has not seen.
      setEntries((previous) => {
        const seen = new Set(previous.map((entry) => entry.seq))
        return [...previous, ...page.entries.filter((entry) => !seen.has(entry.seq))]
      })
      setCursor(page.nextCursor)
    },
    [port],
  )
  useEffect(() => {
    run(async (signal) => {
      await load(signal, null)
    })
  }, [load, run])
  const shown = entries.filter((entry) => isShownByFilter(entry, filter))
  return (
    <section aria-label={UI_TEXT.nodeLabels.audit}>
      <h2>{UI_TEXT.nodeLabels.audit}</h2>
      <div className="node-actions" role="toolbar" aria-label={UI_TEXT.nodeLabels.audit}>
        {FILTER_IDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => {
              setFilter(option)
            }}
          >
            {filterLabel(option)}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            run(async (signal) => {
              await load(signal, null)
            })
          }}
        >
          {UI_TEXT.nodeWorkspace.refresh}
        </button>
      </div>
      {shown.length === 0 ? (
        <p>{UI_TEXT.nodeAudit.noEntries}</p>
      ) : (
        <ul>
          {shown.map((entry) => (
            <AuditEntry key={entry.seq} entry={entry} />
          ))}
        </ul>
      )}
      {cursor !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            run(async (signal) => {
              await load(signal, cursor)
            })
          }}
        >
          {UI_TEXT.nodeAudit.more}
        </button>
      )}
    </section>
  )
}
