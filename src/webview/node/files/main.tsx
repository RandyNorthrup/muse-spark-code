import { createRoot } from 'react-dom/client'
import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import * as z from 'zod/mini'
import {
  NODE_MAX_FILE_BYTES,
  NODE_DIGEST_RADIX,
  WEBVIEW_L10N_ELEMENT_ID,
  UI_TEXT,
} from '../../../shared/constants'
import { EN } from '../../../shared/l10n/en'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'
import type { NodeTerminalSocketFactory } from '../../bridges/nodePort'
import { nodeIdentifierSchema } from '../../../shared/nodeAuth'
import { nodeRelativePathSchema } from '../../../shared/node'
import { NodePageError, isNodePageError, validatedNodePort } from '../../bridges/nodePort'
import { installEmbeddedTable } from '../../installTable'
import { FileTree } from './FileTree'
import { useRequestRunner } from '../requestRunner'
import { GitPage } from '../git/GitPage'
import type { NodePageAuthPort } from '../git/network'
import { DashboardPage } from '../dashboard/DashboardPage'
import { HelpPage } from '../dashboard/HelpPage'
import { WhatsNewPage } from '../dashboard/WhatsNewPage'
import { AuditPage } from '../audit/AuditPage'
import './workspace.css'

const Editor = lazy(async () => {
  const module = await import('../editor/Editor')
  return { default: module.Editor }
})
const EditorDiff = lazy(async () => {
  const module = await import('../editor/Editor')
  return { default: module.EditorDiff }
})
const TerminalTabs = lazy(async () => {
  const module = await import('../terminal/Terminal')
  return { default: module.TerminalTabs }
})

export interface NodeWorkspaceBinding {
  readonly port: NodeMethodPort
  readonly auth: NodePageAuthPort
  readonly workspaceId: string
  readonly connectTerminal: NodeTerminalSocketFactory
}

export function mountNodeWorkspace(element: Element, binding: NodeWorkspaceBinding): () => void {
  // The node build has an inline fallback for this surface's keys. Project
  // the full host table onto that same set, then apply the unchanged table,
  // template, plural and locale checks. Leave the caller's element untouched.
  const page = document.createElement('div')
  const embedded = document.querySelector(`#${WEBVIEW_L10N_ELEMENT_ID}`)
  if (embedded !== null) {
    const input = z
      .strictObject({ locale: z.string(), table: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(embedded.textContent))
    const copy = document.createElement('script')
    copy.type = 'application/json'
    copy.id = WEBVIEW_L10N_ELEMENT_ID
    copy.textContent = JSON.stringify({
      locale: input.locale,
      table: Object.fromEntries(
        Object.entries(input.table).filter(([key]) => Object.hasOwn(EN, key)),
      ),
    })
    page.append(copy)
  }
  const tableError = installEmbeddedTable(page)
  if (tableError !== undefined) throw tableError
  nodeIdentifierSchema.parse(binding.workspaceId)
  const root = createRoot(element)
  root.render(<NodeWorkspace {...binding} port={validatedNodePort(binding.port)} />)
  return () => {
    root.unmount()
  }
}

/** The terminal chunk's boundary: a failed chunk load says so and offers
a retry, which remounts the lazy page for another attempt. */
class TerminalChunkBoundary extends Component<
  { readonly children: ReactNode; readonly onRetry: () => void },
  { readonly failed: boolean }
> {
  public static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  public override state = { failed: false }

  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <>
        <p role="alert">{UI_TEXT.nodeTerminal.chunkFailed}</p>
        <button type="button" onClick={this.props.onRetry}>
          {UI_TEXT.nodeTerminal.retry}
        </button>
      </>
    )
  }
}

function TerminalChunk(props: {
  readonly port: NodeMethodPort
  readonly auth: NodePageAuthPort
  readonly workspaceId: string
  readonly connect: NodeTerminalSocketFactory
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  return (
    <TerminalChunkBoundary
      key={attempt}
      onRetry={() => {
        setAttempt((previous) => previous + 1)
      }}
    >
      <Suspense fallback={<p data-deferred-loading="true">{UI_TEXT.nodeLabels.terminal}</p>}>
        <TerminalTabs {...props} />
      </Suspense>
    </TerminalChunkBoundary>
  )
}

function NodeWorkspace({ port, auth, workspaceId, connectTerminal }: NodeWorkspaceBinding) {
  const [page, setPage] = useState<
    'files' | 'git' | 'terminal' | 'dashboard' | 'audit' | 'help' | 'whatsnew'
  >('files')
  const [opened, setOpened] = useState<NodeMethodResult<'node/files/read'>>()
  const [draft, setDraft] = useState('')
  const [path, setPath] = useState('')
  const [review, setReview] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // The terminal mounts on its first visit (so its chunk stays lazy) and
  // stays mounted after: its shells survive a look at another page.
  const [terminalSeen, setTerminalSeen] = useState(false)
  // Open, save, upload and download serialize under `file`; every Git
  // page request under `git`. Both ride the one request runner: a second
  // request of a busy kind drops, and the lock clears only when the
  // unsettled request settles — even after Cancel aborts it — so a second
  // Save or Push can never overlap the first on the server (RVM110U1 P2 #2).
  const requests = useRequestRunner()
  const isBusy = requests.busy.size > 0
  const abortAllRequests = requests.abortAll
  useEffect(
    () => () => {
      abortAllRequests()
    },
    [abortAllRequests],
  )
  const onError = useCallback((failure: unknown) => {
    const message = failure instanceof Error ? failure.message : ''
    setError(
      Object.values(UI_TEXT.nodeErrors).includes(message) ||
        message === UI_TEXT.nodeWorkspace.unsaved
        ? message
        : UI_TEXT.nodeErrors.unavailable,
    )
  }, [])
  const startRequests = requests.start
  const startKind = useCallback(
    (
      kind: 'file' | 'git' | 'terminal' | 'dashboard' | 'audit' | 'whatsnew',
      work: (signal: AbortSignal) => Promise<void>,
    ) => {
      const pending = startRequests(kind, work)
      // A dropped start runs nothing and reports nothing: like the old
      // single-flight guard it leaves the current error and notice alone.
      if (pending === undefined) return
      setError('')
      setNotice('')
      void pending.catch((error_: unknown) => {
        // Cancellation is silent; the lock still clears on settle. The
        // name check (not instanceof) holds across DOMException realms:
        // the validated port throws the runtime's AbortError, not the
        // webview's. A typed refusal displays; anything else is a bug
        // and is rethrown to the window's failure channel.
        if (
          typeof error_ === 'object' &&
          error_ !== null &&
          'name' in error_ &&
          error_.name === 'AbortError'
        )
          return
        if (isNodePageError(error_)) {
          onError(error_)
          return
        }
        throw error_
      })
    },
    [startRequests, onError],
  )
  const runFile = useCallback(
    (work: (signal: AbortSignal) => Promise<void>) => {
      startKind('file', work)
    },
    [startKind],
  )
  const run = useCallback(
    (work: (signal: AbortSignal) => Promise<void>) => {
      startKind('git', work)
    },
    [startKind],
  )
  const runTerminal = useCallback(
    (work: (signal: AbortSignal) => Promise<void>) => {
      startKind('terminal', work)
    },
    [startKind],
  )
  const runDashboard = useCallback(
    (work: (signal: AbortSignal) => Promise<void>) => {
      startKind('dashboard', work)
    },
    [startKind],
  )
  const runAudit = useCallback(
    (work: (signal: AbortSignal) => Promise<void>) => {
      startKind('audit', work)
    },
    [startKind],
  )
  const runWhatsNew = useCallback(
    (work: (signal: AbortSignal) => Promise<void>) => {
      startKind('whatsnew', work)
    },
    [startKind],
  )
  const openFile = (name: string) => {
    if (opened !== undefined && draft !== opened.text) {
      onError(new Error(UI_TEXT.nodeWorkspace.unsaved))
      return
    }
    runFile(async (signal) => {
      const file = await port.request('node/files/read', { workspaceId, path: name }, signal)
      if (file.path !== name) throw new NodePageError('conflict')
      if (signal.aborted) return
      setOpened(file)
      setDraft(file.text)
      setPath(file.path)
      setReview(false)
      setGeneration((previous) => previous + 1)
    })
  }
  const save = () => {
    if (opened === undefined) return
    const saved = draft
    runFile(async (signal) => {
      const result = await port.request(
        'node/files/write',
        { workspaceId, path: opened.path, expectedDigest: opened.digest, text: saved },
        signal,
      )
      if (signal.aborted) {
        return
      }

      setOpened({ ...opened, text: saved, digest: result.digest })
      setNotice(UI_TEXT.nodeWorkspace.saved)
    })
  }
  return (
    <main className="node-workspace" aria-label={UI_TEXT.nodeLabels.title}>
      <h1>{UI_TEXT.nodeLabels.title}</h1>
      <nav aria-label={UI_TEXT.nodeLabels.title} className="node-actions">
        <button
          type="button"
          aria-pressed={page === 'files'}
          onClick={() => {
            setPage('files')
          }}
        >
          {UI_TEXT.nodeLabels.files}
        </button>
        <button
          type="button"
          aria-pressed={page === 'git'}
          onClick={() => {
            setPage('git')
          }}
        >
          {UI_TEXT.nodeLabels.git}
        </button>
        <button
          type="button"
          aria-pressed={page === 'terminal'}
          onClick={() => {
            setPage('terminal')
            setTerminalSeen(true)
          }}
        >
          {UI_TEXT.nodeLabels.terminal}
        </button>
        <button
          type="button"
          aria-pressed={page === 'dashboard'}
          onClick={() => {
            setPage('dashboard')
          }}
        >
          {UI_TEXT.nodeLabels.dashboard}
        </button>
        <button
          type="button"
          aria-pressed={page === 'audit'}
          onClick={() => {
            setPage('audit')
          }}
        >
          {UI_TEXT.nodeLabels.audit}
        </button>
        <button
          type="button"
          aria-pressed={page === 'help'}
          onClick={() => {
            setPage('help')
          }}
        >
          {UI_TEXT.nodeHelp.title}
        </button>
        <button
          type="button"
          aria-pressed={page === 'whatsnew'}
          onClick={() => {
            setPage('whatsnew')
          }}
        >
          {UI_TEXT.nodeWhatsNew.title}
        </button>
      </nav>
      {error !== '' && <p role="alert">{error}</p>}
      <p role="status">{notice}</p>
      {isBusy && (
        <button
          type="button"
          onClick={() => {
            abortAllRequests()
          }}
        >
          {UI_TEXT.gitCancel}
        </button>
      )}
      <div hidden={page !== 'files'}>
        <FileTree port={port} workspaceId={workspaceId} onOpen={openFile} onError={onError} />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            openFile(path)
          }}
        >
          <label>
            {UI_TEXT.nodeWorkspace.path}
            <input
              value={path}
              onChange={(event) => {
                setPath(event.target.value)
              }}
            />
          </label>
          <button disabled={isBusy || path === ''} type="submit">
            {UI_TEXT.nodeLabels.editor}
          </button>
        </form>
        <label>
          {UI_TEXT.nodeLabels.upload}
          <input
            type="file"
            disabled={isBusy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file === undefined) return
              if (file.size > NODE_MAX_FILE_BYTES) {
                onError(new Error(UI_TEXT.nodeErrors.tooLarge))
                return
              }
              runFile(async (signal) => {
                const target = nodeRelativePathSchema.parse(path === '' ? file.name : path)
                // An upload over the open file with unsaved edits would
                // orphan the draft: refuse it whether the path box names
                // the file or is cleared to the upload's own name.
                if (opened?.path === target) {
                  if (draft !== opened.text) throw new NodePageError('conflict')
                } else if (path !== '') {
                  throw new NodePageError('conflict')
                }
                const bytes = new Uint8Array(await file.arrayBuffer())
                const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
                // Base64 from exact bytes, never UTF-8 conversion of a binary upload.
                const data = btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(''))
                const digest = Array.from(hash, (byte) =>
                  byte.toString(NODE_DIGEST_RADIX).padStart(2, '0'),
                ).join('')
                await port.request(
                  'node/files/upload',
                  {
                    workspaceId,
                    path: target,
                    expectedDigest: opened?.path === target ? opened.digest : null,
                    data,
                    digest,
                  },
                  signal,
                )
                // The saved bytes are no longer the open ones: reload the
                // buffer and digest from the server so the next Save sends
                // the new digest instead of conflicting on the stale one.
                if (opened?.path === target) {
                  let fresh
                  try {
                    fresh = await port.request(
                      'node/files/read',
                      { workspaceId, path: target },
                      signal,
                    )
                  } catch (error: unknown) {
                    // The upload succeeded but the bytes are not UTF-8
                    // text: the buffer cannot show them, so close it with
                    // a clear notice instead of "unavailable". The code —
                    // never a matched message — names the refusal, so it
                    // holds in every display language.
                    if (!signal.aborted && isNodePageError(error) && error.code === 'notText') {
                      setOpened(undefined)
                      setDraft('')
                      setPath('')
                      setReview(false)
                      setGeneration((previous) => previous + 1)
                      setNotice(UI_TEXT.nodeWorkspace.binaryReplaced)
                      return
                    }
                    throw error
                  }
                  if (signal.aborted) return
                  setOpened(fresh)
                  setDraft(fresh.text)
                  setReview(false)
                  setGeneration((previous) => previous + 1)
                }
                if (!signal.aborted) setNotice(UI_TEXT.nodeWorkspace.saved)
              })
            }}
          />
        </label>
        {opened !== undefined && (
          <section
            aria-label={UI_TEXT.nodeLabels.editor}
            onKeyDown={(event) => {
              if (!((event.ctrlKey || event.metaKey) && event.key === 's')) {
                return
              }

              event.preventDefault()
              if (!isBusy) save()
            }}
          >
            <h2>{opened.path}</h2>
            <div className="node-actions">
              <button type="button" disabled={isBusy || draft === opened.text} onClick={save}>
                {UI_TEXT.nodeWorkspace.save}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setReview((previous) => !previous)
                }}
                aria-pressed={review}
              >
                {UI_TEXT.nodeWorkspace.diff}
              </button>
              <button
                type="button"
                disabled={isBusy || draft === opened.text}
                onClick={() => {
                  setDraft(opened.text)
                  setGeneration((previous) => previous + 1)
                  setReview(false)
                }}
              >
                {UI_TEXT.nodeWorkspace.discard}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  runFile(async (signal) => {
                    const result = await port.request(
                      'node/files/download',
                      { workspaceId, path: opened.path },
                      signal,
                    )
                    const bytes = Uint8Array.from(
                      atob(result.data),
                      (character) => character.codePointAt(0) ?? 0,
                    )
                    const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
                    if (
                      Array.from(actual, (byte) =>
                        byte.toString(NODE_DIGEST_RADIX).padStart(2, '0'),
                      ).join('') !== result.digest
                    )
                      throw new NodePageError('conflict')
                    signal.throwIfAborted()
                    const url = URL.createObjectURL(new Blob([bytes]))
                    try {
                      const link = document.createElement('a')
                      link.href = url
                      link.download = opened.path.split('/').at(-1) ?? ''
                      link.click()
                    } finally {
                      URL.revokeObjectURL(url)
                    }
                  })
                }}
              >
                {UI_TEXT.nodeLabels.download}
              </button>
            </div>
            <Suspense fallback={<p data-deferred-loading="true">{UI_TEXT.nodeLabels.editor}</p>}>
              {review ? (
                <EditorDiff original={opened.text} modified={draft} />
              ) : (
                <Editor key={generation} text={draft} onChange={setDraft} />
              )}
            </Suspense>
          </section>
        )}
      </div>
      {page === 'git' && (
        <GitPage port={port} auth={auth} workspaceId={workspaceId} run={run} busy={isBusy} />
      )}
      {(terminalSeen || page === 'terminal') && (
        <div hidden={page !== 'terminal'}>
          <TerminalChunk
            port={port}
            auth={auth}
            workspaceId={workspaceId}
            connect={connectTerminal}
            run={runTerminal}
            busy={isBusy}
          />
        </div>
      )}
      {page === 'dashboard' && <DashboardPage port={port} run={runDashboard} busy={isBusy} />}
      {page === 'audit' && <AuditPage port={port} run={runAudit} busy={isBusy} />}
      {page === 'help' && <HelpPage />}
      {page === 'whatsnew' && <WhatsNewPage port={port} run={runWhatsNew} busy={isBusy} />}
    </main>
  )
}
