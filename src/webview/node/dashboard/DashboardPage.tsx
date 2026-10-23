import { useCallback, useEffect, useState } from 'react'
import {
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUnit,
} from '../../../shared/l10n/text'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'

type Dashboard = NodeMethodResult<'node/dashboard/read'>

/** Uptime units, largest first: the first whose floor the uptime fills. */
const UPTIME_UNITS: readonly { limit: number; unit: 'day' | 'hour' | 'minute' | 'second' }[] = [
  { limit: MILLISECONDS_PER_DAY, unit: 'day' },
  { limit: MILLISECONDS_PER_HOUR, unit: 'hour' },
  { limit: MILLISECONDS_PER_MINUTE, unit: 'minute' },
  { limit: MILLISECONDS_PER_SECOND, unit: 'second' },
]

/** Uptime in the largest whole unit below it: narrow units, localized. */
function formatUptime(uptimeMs: number): string {
  for (const { limit, unit } of UPTIME_UNITS) {
    if (uptimeMs >= limit) return formatUnit(Math.floor(uptimeMs / limit), unit)
  }
  return formatUnit(0, 'second')
}

function surfaceWord(surface: Dashboard['sessions'][number]['surface']): string {
  switch (surface) {
    case 'web': {
      return UI_TEXT.nodeDashboard.sessionWeb
    }
    case 'tui': {
      return UI_TEXT.nodeDashboard.sessionTui
    }
    default: {
      return UI_TEXT.nodeDashboard.sessionEditor
    }
  }
}

export function DashboardPage({
  port,
  run,
  busy,
}: {
  readonly port: NodeMethodPort
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}) {
  const [dashboard, setDashboard] = useState<Dashboard>()
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const current = await port.request('node/dashboard/read', {}, signal)
      if (signal.aborted) return
      setDashboard(current)
    },
    [port],
  )
  useEffect(() => {
    run(refresh)
  }, [refresh, run])
  return (
    <section aria-label={UI_TEXT.nodeLabels.dashboard}>
      <h2>{UI_TEXT.nodeLabels.dashboard}</h2>
      <div className="node-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            run(refresh)
          }}
        >
          {UI_TEXT.nodeWorkspace.refresh}
        </button>
      </div>
      {dashboard !== undefined && (
        <>
          <p>{UI_TEXT.nodeMessages.sharedSandbox}</p>
          <dl>
            <dt>{UI_TEXT.nodeLabels.version}</dt>
            <dd>{dashboard.version}</dd>
            <dt>{UI_TEXT.nodeDashboard.nodeId}</dt>
            <dd>
              <code>{dashboard.nodeId}</code>
            </dd>
            <dt>{UI_TEXT.nodeLabels.uptime}</dt>
            <dd>{formatUptime(dashboard.uptimeMs)}</dd>
            <dt>{UI_TEXT.nodeLabels.cpu}</dt>
            <dd>{formatPercent(dashboard.cpuPercent)}</dd>
            <dt>{UI_TEXT.nodeLabels.memory}</dt>
            <dd>
              {formatBytes(dashboard.memory.usedBytes)} / {formatBytes(dashboard.memory.totalBytes)}
            </dd>
            <dt>{UI_TEXT.nodeLabels.disk}</dt>
            <dd>
              {formatBytes(dashboard.disk.freeBytes)} / {formatBytes(dashboard.disk.totalBytes)}
            </dd>
            <dt>{UI_TEXT.nodeDashboard.pendingChallenges}</dt>
            <dd>{formatNumber(dashboard.pendingChallenges)}</dd>
          </dl>
          <ul>
            {dashboard.locked && <li>{UI_TEXT.nodeErrors.locked}</li>}
            <li>
              {dashboard.keyStoreSealed ? UI_TEXT.nodeLabels.sealed : UI_TEXT.nodeLabels.unsealed}
            </li>
            <li>
              {dashboard.attendance === 'attended'
                ? UI_TEXT.nodeLabels.attended
                : UI_TEXT.nodeLabels.unattended}
            </li>
          </ul>
          <h3>{UI_TEXT.nodeLabels.sessions}</h3>
          {dashboard.sessions.length === 0 ? (
            <p>{UI_TEXT.nodeDashboard.noSessions}</p>
          ) : (
            <ul>
              {dashboard.sessions.map((session) => (
                <li key={session.id}>
                  <code>{session.id}</code> {surfaceWord(session.surface)}{' '}
                  {formatDateTime(session.lastSeenAt)}
                </li>
              ))}
            </ul>
          )}
          <h3>{UI_TEXT.nodeLabels.workspaces}</h3>
          {dashboard.workspaces.length === 0 ? (
            <p>{UI_TEXT.nodeDashboard.noWorkspaces}</p>
          ) : (
            <ul>
              {dashboard.workspaces.map((workspace) => (
                <li key={workspace.id}>
                  {workspace.label} <code>{workspace.path}</code>{' '}
                  {workspace.trusted
                    ? UI_TEXT.nodeDashboard.trusted
                    : UI_TEXT.nodeDashboard.untrusted}{' '}
                  {formatDateTime(workspace.lastUsedAt)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
