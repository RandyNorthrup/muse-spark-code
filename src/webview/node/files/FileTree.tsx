import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  NODE_FILE_TREE_ROW_PX,
  NODE_FILE_TREE_VISIBLE_ROWS,
  NODE_FILE_TREE_OVERSCAN_ROWS,
  NODE_GIT_IMPORT_MAX_FILES,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'
import { NodePageError, isNodePageError } from '../../bridges/nodePort'
import { useRequestRunner } from '../requestRunner'

type Listing = NodeMethodResult<'node/files/list'>
interface Row {
  entry: Listing['entries'][number]
  level: number
  position: number
  count: number
  parent: string
}

export function FileTree({
  port,
  workspaceId,
  onOpen,
  onError,
}: {
  readonly port: NodeMethodPort
  readonly workspaceId: string
  readonly onOpen: (path: string) => void
  readonly onError: (error: unknown) => void
}) {
  const [pages, setPages] = useState<Record<string, Listing>>({})
  const currentPages = useRef(pages)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Listing>()
  const resultQuery = useRef('')
  const [active, setActive] = useState(0)
  const [start, setStart] = useState(0)
  const tree = useRef<HTMLDivElement>(null)
  // Every request below runs through the one request runner: directory
  // pages under `directory:<name>`, submit and Show more under `search`.
  const requests = useRequestRunner()
  const startRequest = requests.start
  const invalidateRequests = requests.invalidate
  const abortAllRequests = requests.abortAll
  const busyKinds = requests.busy
  useEffect(() => {
    void startRequest('directory:', async (signal, isCurrent) => {
      try {
        const page = await port.request(
          'node/files/list',
          { workspaceId, directory: null, cursor: null },
          signal,
        )
        if (signal.aborted || !isCurrent()) return
        currentPages.current = { '': page }
        setPages(currentPages.current)
      } catch (error: unknown) {
        // A supersede or invalidate aborts before it retires the id, and
        // unmount aborts every signal, so a stale failure is always an
        // aborted one here: the abort check alone drops it. A typed
        // refusal displays; anything else is a bug and is rethrown to
        // the window's failure channel.
        if (signal.aborted) return
        if (isNodePageError(error)) {
          onError(error)
          return
        }
        throw error
      }
    })
    return () => {
      abortAllRequests()
    }
  }, [port, workspaceId, onError, startRequest, abortAllRequests])
  const rows: Row[] = []
  const append = (directory: string, level: number) => {
    const entries = pages[directory]?.entries ?? []
    for (const [index, entry] of entries.entries()) {
      rows.push({ entry, level, position: index + 1, count: entries.length, parent: directory })
      if (expanded.has(entry.path)) append(entry.path, level + 1)
    }
  }
  if (results === undefined) {
    append('', 1)
  } else {
    for (const [index, entry] of results.entries.entries()) {
      rows.push({ entry, level: 1, position: index + 1, count: results.entries.length, parent: '' })
    }
  }
  const load = (directory: string, cursor: string | null) => {
    // One pending page per directory: a second load of the same kind
    // drops while the first is unsettled, so pages cannot double-append.
    void startRequest(`directory:${directory}`, async (signal, isCurrent) => {
      try {
        const page = await port.request(
          'node/files/list',
          { workspaceId, directory: directory === '' ? null : directory, cursor },
          signal,
        )
        if (signal.aborted || !isCurrent()) return
        const previous = currentPages.current
        const entries =
          cursor === null
            ? page.entries
            : [...(previous[directory]?.entries ?? []), ...page.entries]
        if (
          Object.entries(previous)
            .filter(([name]) => name !== directory)
            .reduce((sum, [, listing]) => sum + listing.entries.length, entries.length) >
          NODE_GIT_IMPORT_MAX_FILES
        )
          throw new NodePageError('tooLarge')
        currentPages.current = { ...previous, [directory]: { ...page, entries } }
        setPages(currentPages.current)
        setExpanded((previousExpanded) => new Set([...previousExpanded, directory]))
      } catch (error: unknown) {
        // A supersede or invalidate aborts before it retires the id, and
        // unmount aborts every signal, so a stale failure is always an
        // aborted one here: the abort check alone drops it. A typed
        // refusal displays; anything else is a bug and is rethrown to
        // the window's failure channel.
        if (signal.aborted) return
        if (isNodePageError(error)) {
          onError(error)
          return
        }
        throw error
      }
    })
  }
  const activate = (row: Row) => {
    if (row.entry.kind === 'file') {
      onOpen(row.entry.path)
      return
    }
    if (results !== undefined) {
      // Clearing the results retires the search id: a pending Show more
      // page for the old results is dropped instead of resurrecting them.
      invalidateRequests('search')
      setResults(undefined)
      setQuery('')
    }
    if (expanded.has(row.entry.path))
      setExpanded((previous) => new Set([...previous].filter((name) => name !== row.entry.path)))
    else if (pages[row.entry.path] === undefined) {
      load(row.entry.path, null)
    } else {
      setExpanded((previous) => new Set([...previous, row.entry.path]))
    }
  }
  const move = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index))
    setActive(next)
    if (tree.current !== null)
      tree.current.scrollTop =
        Math.max(0, next - NODE_FILE_TREE_OVERSCAN_ROWS) * NODE_FILE_TREE_ROW_PX
    setStart(Math.max(0, next - NODE_FILE_TREE_OVERSCAN_ROWS))
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[active]
    switch (event.key) {
      case 'ArrowDown': {
        move(active + 1)
        break
      }
      case 'ArrowUp': {
        move(active - 1)
        break
      }
      case 'Home': {
        move(0)
        break
      }
      case 'End': {
        move(rows.length - 1)
        break
      }
      case 'Enter':
      case ' ': {
        if (row !== undefined) activate(row)
        break
      }
      case 'ArrowRight': {
        if (row?.entry.kind === 'directory' && !expanded.has(row.entry.path)) activate(row)
        else move(active + 1)
        break
      }
      case 'ArrowLeft': {
        if (row !== undefined && expanded.has(row.entry.path)) activate(row)
        else if (row !== undefined) move(rows.findIndex((item) => item.entry.path === row.parent))
        break
      }
      default: {
        return
      }
    }
    event.preventDefault()
  }
  const activeRow = rows[Math.min(active, Math.max(0, rows.length - 1))]
  const pending = Object.entries(pages).find(
    ([directory, page]) =>
      page.nextCursor !== null && (directory === '' || expanded.has(directory)),
  )
  return (
    <section aria-label={UI_TEXT.nodeLabels.files}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const submitted = query
          if (submitted.trim() === '') {
            // Clearing the query retires the search id with it.
            invalidateRequests('search')
            setResults(undefined)
            return
          }
          // A new search supersedes: it aborts a pending Show more page
          // for the old query, whose late response is then dropped.
          void startRequest(
            'search',
            async (signal, isCurrent) => {
              try {
                const page = await port.request(
                  'node/files/search',
                  { workspaceId, query: submitted, cursor: null },
                  signal,
                )
                if (signal.aborted || !isCurrent()) return
                setResults(page)
                resultQuery.current = submitted
                move(0)
              } catch (error: unknown) {
                // A supersede or invalidate aborts before it retires the
                // id, so a stale failure is always an aborted one here:
                // the abort check alone drops it. A typed refusal
                // displays; anything else is a bug and is rethrown to
                // the window's failure channel.
                if (signal.aborted) return
                if (isNodePageError(error)) {
                  onError(error)
                  return
                }
                throw error
              }
            },
            { supersede: true },
          )
        }}
      >
        <label>
          {UI_TEXT.nodeWorkspace.search}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </label>
        <button type="submit">{UI_TEXT.nodeWorkspace.search}</button>
      </form>
      <div
        ref={tree}
        role="tree"
        tabIndex={0}
        aria-label={UI_TEXT.nodeLabels.files}
        aria-activedescendant={
          activeRow === undefined
            ? undefined
            : `node-file-${encodeURIComponent(activeRow.entry.path)}`
        }
        onKeyDown={key}
        onScroll={(event) => {
          setStart(Math.floor(event.currentTarget.scrollTop / NODE_FILE_TREE_ROW_PX))
        }}
        className="node-file-tree"
        style={{ height: NODE_FILE_TREE_VISIBLE_ROWS * NODE_FILE_TREE_ROW_PX }}
      >
        <div style={{ height: rows.length * NODE_FILE_TREE_ROW_PX, position: 'relative' }}>
          {rows
            .filter(
              (row, index) =>
                row === activeRow ||
                (index >= Math.max(0, start - NODE_FILE_TREE_OVERSCAN_ROWS) &&
                  index < start + NODE_FILE_TREE_VISIBLE_ROWS + NODE_FILE_TREE_OVERSCAN_ROWS),
            )
            .map((row) => (
              <div
                key={row.entry.path}
                id={`node-file-${encodeURIComponent(row.entry.path)}`}
                role="treeitem"
                aria-level={row.level}
                aria-posinset={row.position}
                aria-setsize={row.count}
                aria-selected={row === activeRow}
                aria-expanded={
                  row.entry.kind === 'directory' ? expanded.has(row.entry.path) : undefined
                }
                className="node-file-row"
                style={{
                  position: 'absolute',
                  top: rows.indexOf(row) * NODE_FILE_TREE_ROW_PX,
                  height: NODE_FILE_TREE_ROW_PX,
                  paddingInlineStart: (row.level - 1) * NODE_FILE_TREE_ROW_PX,
                }}
                onClick={() => {
                  setActive(rows.indexOf(row))
                  activate(row)
                  tree.current?.focus()
                }}
              >
                {row.entry.kind === 'directory' && (
                  <span aria-hidden="true" className="node-file-disclosure" />
                )}
                {row.entry.path}
              </div>
            ))}
        </div>
      </div>
      {rows.length === 0 && <p>{UI_TEXT.nodeWorkspace.noFiles}</p>}
      {results !== undefined && results.nextCursor !== null ? (
        <button
          type="button"
          disabled={busyKinds.has('search')}
          onClick={() => {
            const cursor = results.nextCursor
            const shownQuery = resultQuery.current
            // Show more shares the search kind without superseding: while
            // its page is in flight the button is disabled and a second
            // click drops, so the same page can never append twice.
            void startRequest('search', async (signal, isCurrent) => {
              try {
                const page = await port.request(
                  'node/files/search',
                  { workspaceId, query: shownQuery, cursor },
                  signal,
                )
                if (signal.aborted || !isCurrent()) return
                // Append like the directory tree: the page already on
                // screen stays; only the new entries are added. A cleared
                // or replaced search retires the id first, so a late page
                // can neither resurrect nor pollute the results.
                setResults((previous) =>
                  previous?.nextCursor === cursor
                    ? { ...page, entries: [...previous.entries, ...page.entries] }
                    : previous,
                )
              } catch (error: unknown) {
                // A supersede or invalidate aborts before it retires the
                // id, so a stale failure is always an aborted one here:
                // the abort check alone drops it. A typed refusal
                // displays; anything else is a bug and is rethrown to
                // the window's failure channel.
                if (signal.aborted) return
                if (isNodePageError(error)) {
                  onError(error)
                  return
                }
                throw error
              }
            })
          }}
        >
          {UI_TEXT.shareShowMore}
        </button>
      ) : (
        pending !== undefined &&
        results === undefined && (
          <button
            type="button"
            disabled={busyKinds.has(`directory:${pending[0]}`)}
            onClick={() => {
              load(pending[0], pending[1].nextCursor)
            }}
          >
            {UI_TEXT.shareShowMore}
          </button>
        )
      )}
    </section>
  )
}
