/** @vitest-environment jsdom */
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FileTree } from '../../src/webview/node/files/FileTree'
import { isNodePageError, validatedNodePort } from '../../src/webview/bridges/nodePort'
import { NODE_FILE_TREE_ROW_PX, NODE_MAX_PAGE_ITEMS, UI_TEXT } from '../../src/shared/constants'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'
import { recordCalls, scripted } from './helpers/recordCalls'

afterEach(cleanup)
const entry = (name: string) => ({ path: name, kind: 'file', sizeBytes: 0 })
type TreeRequest = (
  method: NodeMethodName,
  params: unknown,
  signal: AbortSignal,
) => Promise<unknown>
function mount(request: TreeRequest) {
  const onError = recordCalls<[unknown]>()
  const onOpen = recordCalls<[string]>()
  return {
    ...render(
      <FileTree
        port={validatedNodePort({ request })}
        workspaceId="repo"
        onOpen={onOpen.fn}
        onError={onError.fn}
      />,
    ),
    onError,
  }
}
// One controllable search: page turns stay pending until the test resolves
// them, so races against submits, clears and double clicks are exact. The
// second answer models a new query landing with no next page.
function pendingSearch() {
  const page = Promise.withResolvers<unknown>()
  let pageSignal: AbortSignal | undefined
  const request = scripted<[NodeMethodName, unknown, AbortSignal], Promise<unknown>>(
    (method, input, signal) => {
      if (method === 'node/files/list') return Promise.resolve({ entries: [], nextCursor: null })
      const shaped = typeof input === 'object' && input !== null ? input : {}
      const isPage = 'cursor' in shaped && typeof shaped.cursor === 'string'
      if (isPage) {
        pageSignal = signal
      }
      const query = 'query' in shaped && shaped.query === 'second' ? 'second' : 'first'
      return isPage
        ? page.promise
        : Promise.resolve({
            entries: [entry(query)],
            nextCursor: query === 'first' ? 'page-1' : null,
          })
    },
  )
  const ui = mount(request)
  const submit = (value: string) => {
    fireEvent.change(ui.getByRole('textbox'), { target: { value } })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.search }))
  }
  const showMore = () => {
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.shareShowMore }))
  }
  return {
    ui,
    request,
    page,
    pendingSignal: () => pageSignal,
    submit,
    showMore,
    /** Submits the first query and holds its page turn in flight. */
    firstPage: async () => {
      submit('first')
      await ui.findByRole('treeitem', { name: 'first' })
      showMore()
      // The page turn holds the search kind: its button is disabled.
      expect(ui.getByRole('button', { name: UI_TEXT.shareShowMore })).toBeDisabled()
    },
  }
}

async function expectLatePageDropped(
  tree: ReturnType<typeof mount>,
  page: PromiseWithResolvers<unknown>,
): Promise<void> {
  page.resolve({ entries: [entry('stale')], nextCursor: null })
  // Let the late response settle: on the old code it lands here.
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(tree.queryByRole('treeitem', { name: 'stale' })).toBeNull()
  expect(tree.onError.calls).toHaveLength(0)
}

describe('M110-U1 bounded keyboard file tree', () => {
  it('H09 admits one pending page per directory when a folder is clicked repeatedly', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>()
    const request = scripted<[NodeMethodName, unknown, AbortSignal], Promise<unknown>>(
      (_method, input) => {
        if (
          typeof input === 'object' &&
          input !== null &&
          'directory' in input &&
          input.directory === null
        )
          return Promise.resolve({
            entries: [{ path: 'folder', kind: 'directory', sizeBytes: 0 }],
            nextCursor: null,
          })
        return promise
      },
    )
    const ui = mount(request)
    const folder = await ui.findByRole('treeitem', { name: 'folder' })
    fireEvent.click(folder)
    fireEvent.click(folder)
    expect(request.calls).toHaveLength(2)
    resolve({ entries: [entry('folder/child')], nextCursor: null })
    await ui.findByRole('treeitem', { name: 'folder/child' })
  })
  it('H10 gives filenames with spaces and punctuation a valid active-descendant identifier', async () => {
    const ui = mount(() =>
      Promise.resolve({ entries: [entry('with space % file.txt')], nextCursor: null }),
    )
    await ui.findByRole('treeitem', { name: 'with space % file.txt' })
    const tree = ui.getByRole('tree')
    expect(tree.getAttribute('aria-activedescendant')).not.toMatch(/\s/u)
    expect(tree.querySelector('[role="treeitem"]')?.id).toBe(
      tree.getAttribute('aria-activedescendant'),
    )
  })
  it('keeps the active descendant present when the visible window scrolls away', async () => {
    const ui = mount(() =>
      Promise.resolve({
        entries: Array.from({ length: 100 }, (_, index) => entry(`file-${String(index)}`)),
        nextCursor: null,
      }),
    )
    await ui.findAllByRole('treeitem')
    const tree = ui.getByRole('tree')
    fireEvent.scroll(tree, { target: { scrollTop: NODE_FILE_TREE_ROW_PX * 50 } })
    expect(tree.querySelector('[aria-selected="true"]')?.id).toBe(
      tree.getAttribute('aria-activedescendant'),
    )
    expect(ui.getByRole('treeitem', { name: 'file-0' })).toHaveAttribute('aria-selected', 'true')
  })
  it('paginates the submitted search query even when the input is being edited', async () => {
    const request = scripted<[NodeMethodName, unknown, AbortSignal], Promise<unknown>>(
      (method, input) => {
        if (method === 'node/files/list') return Promise.resolve({ entries: [], nextCursor: null })
        const isLater =
          typeof input === 'object' && input !== null && 'cursor' in input && input.cursor !== null
        return Promise.resolve({
          entries: [entry(isLater ? 'later' : 'first')],
          nextCursor: isLater ? null : 'page-1',
        })
      },
    )
    const ui = mount(request)
    fireEvent.change(ui.getByRole('textbox'), { target: { value: 'submitted' } })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.search }))
    await ui.findByRole('treeitem', { name: 'first' })
    fireEvent.change(ui.getByRole('textbox'), { target: { value: 'editing next query' } })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.shareShowMore }))
    await ui.findByRole('treeitem', { name: 'later' })
    // The first page must stay on screen: Show more appends like the
    // directory tree instead of replacing the visible list.
    expect(ui.getByRole('treeitem', { name: 'first' })).toBeInTheDocument()
    expect(ui.queryByRole('button', { name: UI_TEXT.shareShowMore })).toBeNull()
    expect(request.calls.at(-1)?.[1]).toEqual({
      workspaceId: 'repo',
      query: 'submitted',
      cursor: 'page-1',
    })
  })
  it('drops a Show more page still in flight when a new search supersedes it', async () => {
    const search = pendingSearch()
    const { ui, page } = search
    await search.firstPage()
    search.submit('second')
    await ui.findByRole('treeitem', { name: 'second' })
    // The new search aborts the old page turn.
    expect(search.pendingSignal()?.aborted).toBe(true)
    await expectLatePageDropped(ui, page)
    // The late page lands on nothing: neither resurrected beside the new
    // search nor appended onto it.
    expect(ui.queryByRole('treeitem', { name: 'first' })).toBeNull()
    expect(ui.getByRole('treeitem', { name: 'second' })).toBeInTheDocument()
    expect(ui.queryByRole('button', { name: UI_TEXT.shareShowMore })).toBeNull()
  })
  it('drops a Show more page still in flight after the results are cleared', async () => {
    const search = pendingSearch()
    const { ui, page } = search
    await search.firstPage()
    // Clearing the query retires the search id with the results.
    search.submit('  ')
    await ui.findByText(UI_TEXT.nodeWorkspace.noFiles)
    await expectLatePageDropped(ui, page)
    expect(ui.queryByRole('treeitem', { name: 'first' })).toBeNull()
    expect(ui.queryByRole('button', { name: UI_TEXT.shareShowMore })).toBeNull()
  })
  it('disables Show more while its page is in flight so one page never appends twice', async () => {
    const search = pendingSearch()
    const { ui, page, request } = search
    await search.firstPage()
    // A second click before the response still dispatches nothing: the
    // kind is busy, so the start drops even past the disabled button.
    search.showMore()
    expect(
      request.calls.filter(
        ([, input]) =>
          typeof input === 'object' &&
          input !== null &&
          'cursor' in input &&
          typeof input.cursor === 'string',
      ),
    ).toHaveLength(1)
    page.resolve({ entries: [entry('later')], nextCursor: null })
    await ui.findByRole('treeitem', { name: 'later' })
    expect(ui.getAllByRole('treeitem')).toHaveLength(2)
    expect(ui.getByRole('treeitem', { name: 'first' })).toBeInTheDocument()
    expect(ui.queryByRole('button', { name: UI_TEXT.shareShowMore })).toBeNull()
    expect(ui.onError.calls).toHaveLength(0)
  })
  it('H09 refuses to retain more than the workspace entry bound across expanded directories', async () => {
    const ui = mount((_method, input) => {
      const directory =
        typeof input === 'object' &&
        input !== null &&
        'directory' in input &&
        typeof input.directory === 'string'
          ? input.directory
          : null
      return Promise.resolve({
        entries:
          directory === null
            ? Array.from({ length: 10 }, (_, index) => ({
                path: `folder-${String(index)}`,
                kind: 'directory',
                sizeBytes: 0,
              }))
            : Array.from({ length: NODE_MAX_PAGE_ITEMS }, (_, index) =>
                entry(`${directory}/file-${String(index)}`),
              ),
        nextCursor: null,
      })
    })
    await ui.findAllByRole('treeitem')
    const tree = ui.getByRole('tree')
    for (let folder = 9; folder >= 0; folder -= 1) {
      fireEvent.keyDown(tree, { key: 'Home' })
      for (let step = 0; step < folder; step += 1) fireEvent.keyDown(tree, { key: 'ArrowDown' })
      fireEvent.click(ui.getByRole('treeitem', { name: `folder-${String(folder)}` }))
      if (folder === 0)
        await waitFor(() => {
          expect(ui.onError.calls).toHaveLength(1)
        })
      else
        await waitFor(() => {
          expect(ui.getByRole('treeitem', { name: `folder-${String(folder)}` })).toHaveAttribute(
            'aria-expanded',
            'true',
          )
        })
    }
    expect(ui.onError.calls).toHaveLength(1)
    const [failure] = ui.onError.calls[0] ?? []
    if (!isNodePageError(failure)) throw new Error('expected a typed page refusal')
    expect(failure.code).toBe('tooLarge')
  })
  it('H08 aborts its pending list when the surface is disposed', () => {
    let signal: AbortSignal | undefined
    const ui = mount((_method, _input, current) => {
      signal = current
      return new Promise((resolve) => {
        current.addEventListener(
          'abort',
          () => {
            resolve(undefined)
          },
          { once: true },
        )
      })
    })
    ui.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
