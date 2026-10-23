import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'
import { runNetworkGit, type NetworkGitMethod, type NodePageAuthPort } from './network'

export function GitPage({
  port,
  auth,
  workspaceId,
  run,
  busy,
}: {
  readonly port: NodeMethodPort
  readonly auth: NodePageAuthPort
  readonly workspaceId: string
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}) {
  const [status, setStatus] = useState<NodeMethodResult<'node/git/status'>>()
  const [branches, setBranches] = useState<NodeMethodResult<'node/git/branches'>>()
  const [diff, setDiff] = useState<NodeMethodResult<'node/git/diff'>>()
  const [staged, setStaged] = useState(false)
  const [message, setMessage] = useState('')
  const [branch, setBranch] = useState('')
  const [remote, setRemote] = useState('')
  const [confirm, setConfirm] = useState<NetworkGitMethod>()
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const current = await port.request('node/git/status', { workspaceId, cursor: null }, signal)
      const names = await port.request('node/git/branches', { workspaceId, cursor: null }, signal)
      if (signal.aborted) return
      setStatus(current)
      setBranches(names)
      setDiff(undefined)
      setRemote((previous) =>
        current.remotes.some((entry) => entry.name === previous)
          ? previous
          : (current.remotes[0]?.name ?? ''),
      )
      setConfirm(undefined)
    },
    [port, workspaceId],
  )
  useEffect(() => {
    run(refresh)
  }, [refresh, run])
  const destination = status?.remotes.find((entry) => entry.name === remote)?.destination
  const actionLabel = (method: NetworkGitMethod) =>
    ({
      'node/git/push': UI_TEXT.gitPushAction,
      'node/git/pull': UI_TEXT.nodeWorkspace.pull,
      'node/git/fetch': UI_TEXT.nodeWorkspace.fetch,
    })[method]
  return (
    <section aria-label={UI_TEXT.nodeLabels.git}>
      <h2>{UI_TEXT.nodeLabels.git}</h2>
      <button
        disabled={busy}
        type="button"
        onClick={() => {
          run(refresh)
        }}
      >
        {UI_TEXT.nodeWorkspace.refresh}
      </button>
      {status !== undefined && (
        <>
          <p>
            {UI_TEXT.gitPrHead}: <code>{status.branch ?? UI_TEXT.gitPushDetached}</code>
          </p>
          <p>
            {UI_TEXT.nodeWorkspace.head}: <code>{status.head}</code>
          </p>
          <ul>
            {status.changes.map((change) => (
              <li key={change.path}>
                <code>{change.path}</code>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    run(async (signal) => {
                      await port.request(
                        'node/git/stage',
                        { workspaceId, paths: [change.path] },
                        signal,
                      )
                      await refresh(signal)
                    })
                  }}
                >
                  {UI_TEXT.nodeWorkspace.stage}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    run(async (signal) => {
                      const result = await port.request(
                        'node/git/diff',
                        { workspaceId, path: change.path, staged },
                        signal,
                      )
                      if (!signal.aborted) setDiff(result)
                    })
                  }}
                >
                  {UI_TEXT.nodeWorkspace.diff}
                </button>
              </li>
            ))}
          </ul>
          {status.nextCursor !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                run(async (signal) => {
                  const page = await port.request(
                    'node/git/status',
                    { workspaceId, cursor: status.nextCursor },
                    signal,
                  )
                  if (signal.aborted) {
                    return
                  }

                  // Append like the directory tree: keep the changes
                  // already shown and add only the new page.
                  setStatus((previous) =>
                    previous === undefined
                      ? page
                      : { ...page, changes: [...previous.changes, ...page.changes] },
                  )
                  setConfirm(undefined)
                })
              }}
            >
              {UI_TEXT.shareShowMore}
            </button>
          )}
          <label>
            <input
              type="checkbox"
              checked={staged}
              onChange={(event) => {
                setStaged(event.target.checked)
                setDiff(undefined)
              }}
            />
            {UI_TEXT.gitFileStaged}
          </label>
          {diff !== undefined && (
            <div tabIndex={0} aria-label={UI_TEXT.nodeWorkspace.diff} className="node-git-diff">
              <pre>{diff.diff}</pre>
              {diff.truncated && <p>{UI_TEXT.nodeWorkspace.truncated}</p>}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              run(async (signal) => {
                await port.request(
                  'node/git/commit',
                  { workspaceId, expectedHead: status.head, message },
                  signal,
                )
                if (!signal.aborted) setMessage('')
                await refresh(signal)
              })
            }}
          >
            <label>
              {UI_TEXT.gitMessageLabel}
              <textarea
                value={message}
                disabled={busy}
                onChange={(event) => {
                  setMessage(event.target.value)
                }}
              />
            </label>
            <button disabled={busy || message.trim() === ''} type="submit">
              {UI_TEXT.gitCommitAction}
            </button>
          </form>
          <h3>{UI_TEXT.nodeWorkspace.branches}</h3>
          <ul>
            {branches?.branches.map((entry) => (
              <li key={entry.name}>
                <code>{entry.name}</code>
                {entry.current && <> {UI_TEXT.nodeWorkspace.currentBranch}</>}
              </li>
            ))}
          </ul>
          {branches?.nextCursor !== null && branches !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                run(async (signal) => {
                  const page = await port.request(
                    'node/git/branches',
                    { workspaceId, cursor: branches.nextCursor },
                    signal,
                  )
                  if (!signal.aborted)
                    setBranches((previous) =>
                      previous === undefined
                        ? page
                        : { ...page, branches: [...previous.branches, ...page.branches] },
                    )
                })
              }}
            >
              {UI_TEXT.shareShowMore}
            </button>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              run(async (signal) => {
                await port.request(
                  'node/git/branch',
                  { workspaceId, expectedHead: status.head, name: branch },
                  signal,
                )
                if (!signal.aborted) setBranch('')
                await refresh(signal)
              })
            }}
          >
            <label>
              {UI_TEXT.nodeWorkspace.branchName}
              <input
                value={branch}
                disabled={busy}
                onChange={(event) => {
                  setBranch(event.target.value)
                }}
              />
            </label>
            <button disabled={busy || branch === ''} type="submit">
              {UI_TEXT.nodeWorkspace.createBranch}
            </button>
          </form>
          <label>
            {UI_TEXT.gitPrRemote}
            <select
              disabled={busy}
              value={remote}
              onChange={(event) => {
                setRemote(event.target.value)
                setConfirm(undefined)
              }}
            >
              {status.remotes.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {destination !== undefined && (
            <dl>
              <dt>{UI_TEXT.nodeWorkspace.destination}</dt>
              <dd>
                <code>
                  {destination.user}@{destination.host}:{destination.port}/{destination.repository}
                </code>
              </dd>
              <dt>{UI_TEXT.nodeWorkspace.hostKey}</dt>
              <dd>
                <code>{destination.hostKeyDigest}</code>
              </dd>
            </dl>
          )}
          <div className="node-actions">
            {(['node/git/fetch', 'node/git/pull', 'node/git/push'] as const).map((method) => (
              <button
                key={method}
                type="button"
                disabled={
                  busy ||
                  destination === undefined ||
                  status.branch === null ||
                  status.head === null
                }
                onClick={() => {
                  setConfirm(method)
                }}
              >
                {actionLabel(method)}
              </button>
            ))}
          </div>
          {confirm !== undefined && (
            <div role="group" aria-label={UI_TEXT.nodeLabels.stepUp}>
              <p>
                {fill(UI_TEXT.nodeWorkspace.networkConfirm, {
                  action: actionLabel(confirm),
                  remote,
                  ref: status.branch ?? '',
                  head: status.head ?? '',
                })}
              </p>
              <button
                disabled={busy}
                type="button"
                onClick={() => {
                  run(async (signal) => {
                    await runNetworkGit(port, auth, confirm, workspaceId, status, remote, signal)
                    await refresh(signal)
                  })
                }}
              >
                {UI_TEXT.nodeLabels.stepUp}
              </button>
              <button
                disabled={busy}
                type="button"
                onClick={() => {
                  setConfirm(undefined)
                }}
              >
                {UI_TEXT.gitCancel}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
