import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  NODE_FILE_TREE_ROW_PX,
  NODE_FILE_TREE_VISIBLE_ROWS,
  NODE_FILE_TREE_OVERSCAN_ROWS,
  NODE_GIT_IMPORT_MAX_FILES,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'

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
  const lifetime = useRef<AbortController | undefined>(undefined)
  const searching = useRef<AbortController | undefined>(undefined)
  const loading = useRef(new Set<string>())
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void port
      .request('node/files/list', { workspaceId, directory: null, cursor: null }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        currentPages.current = { '': page }
        setPages(currentPages.current)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onError(error)
      })
    return () => {
      controller.abort()
      searching.current?.abort()
    }
  }, [port, workspaceId, onError])
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
  const load = async (directory: string, cursor: string | null) => {
    const signal = lifetime.current?.signal
    if (signal === undefined || loading.current.has(directory)) return
    loading.current.add(directory)
    try {
      const page = await port.request(
        'node/files/list',
        { workspaceId, directory: directory === '' ? null : directory, cursor },
        signal,
      )
      if (signal.aborted) return
      const previous = currentPages.current
      const entries =
        cursor === null ? page.entries : [...(previous[directory]?.entries ?? []), ...page.entries]
      if (
        Object.entries(previous)
          .filter(([name]) => name !== directory)
          .reduce((sum, [, listing]) => sum + listing.entries.length, entries.length) >
        NODE_GIT_IMPORT_MAX_FILES
      )
        throw new Error(UI_TEXT.nodeErrors.tooLarge)
      currentPages.current = { ...previous, [directory]: { ...page, entries } }
      setPages(currentPages.current)
      setExpanded((previous) => new Set([...previous, directory]))
    } catch (error: unknown) {
      if (!signal.aborted) onError(error)
    } finally {
      loading.current.delete(directory)
    }
  }
  const activate = (row: Row) => {
    if (row.entry.kind === 'file') {
      onOpen(row.entry.path)
      return
    }
    if (results !== undefined) {
      setResults(undefined)
      setQuery('')
    }
    if (expanded.has(row.entry.path))
      setExpanded((previous) => new Set([...previous].filter((name) => name !== row.entry.path)))
    else if (pages[row.entry.path] === undefined) {
      void load(row.entry.path, null)
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
          searching.current?.abort()
          if (query.trim() === '') {
            setResults(undefined)
            return
          }
          const controller = new AbortController()
          searching.current = controller
          const signal = AbortSignal.any([
            controller.signal,
            lifetime.current?.signal ?? controller.signal,
          ])
          void port
            .request('node/files/search', { workspaceId, query, cursor: null }, signal)
            .then((page) => {
              if (signal.aborted) {
                return
              }

              setResults(page)
              resultQuery.current = query
              move(0)
            })
            .catch((error: unknown) => {
              if (!signal.aborted) onError(error)
            })
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
          onClick={() => {
            const signal = lifetime.current?.signal
            if (signal !== undefined)
              void port
                .request(
                  'node/files/search',
                  { workspaceId, query: resultQuery.current, cursor: results.nextCursor },
                  signal,
                )
                .then((page) => {
                  if (signal.aborted) {
                    return
                  }

                  // Append like the directory tree: the page already on
                  // screen stays; only the new entries are added.
                  setResults((previous) =>
                    previous === undefined
                      ? page
                      : { ...page, entries: [...previous.entries, ...page.entries] },
                  )
                })
                .catch((error: unknown) => {
                  if (!signal.aborted) onError(error)
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
            onClick={() => {
              void load(pending[0], pending[1].nextCursor)
            }}
          >
            {UI_TEXT.shareShowMore}
          </button>
        )
      )}
    </section>
  )
}
