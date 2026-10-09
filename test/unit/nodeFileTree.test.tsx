/** @vitest-environment jsdom */
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../../src/webview/node/files/FileTree'
import { validatedNodePort } from '../../src/webview/bridges/nodePort'
import { NODE_FILE_TREE_ROW_PX, NODE_MAX_PAGE_ITEMS, UI_TEXT } from '../../src/shared/constants'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'

afterEach(cleanup)
const entry = (name: string) => ({ path: name, kind: 'file', sizeBytes: 0 })
function mount(
  request: (method: NodeMethodName, params: unknown, signal: AbortSignal) => Promise<unknown>,
) {
  const onError = vi.fn()
  return {
    ...render(
      <FileTree
        port={validatedNodePort({ request })}
        workspaceId="repo"
        onOpen={vi.fn()}
        onError={onError}
      />,
    ),
    onError,
  }
}
describe('M110-U1 bounded keyboard file tree', () => {
  it('H09 admits one pending page per directory when a folder is clicked repeatedly', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>()
    const request = vi.fn<
      (method: NodeMethodName, input: unknown, signal: AbortSignal) => Promise<unknown>
    >((_method, input) => {
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
    })
    const ui = mount(request)
    const folder = await ui.findByRole('treeitem', { name: 'folder' })
    fireEvent.click(folder)
    fireEvent.click(folder)
    expect(request).toHaveBeenCalledTimes(2)
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
    const request = vi.fn<
      (method: NodeMethodName, params: unknown, signal: AbortSignal) => Promise<unknown>
    >((method, input) => {
      if (method === 'node/files/list') return Promise.resolve({ entries: [], nextCursor: null })
      const isLater =
        typeof input === 'object' && input !== null && 'cursor' in input && input.cursor !== null
      return Promise.resolve({
        entries: [entry(isLater ? 'later' : 'first')],
        nextCursor: isLater ? null : 'page-1',
      })
    })
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
    expect(request.mock.calls.at(-1)?.[1]).toEqual({
      workspaceId: 'repo',
      query: 'submitted',
      cursor: 'page-1',
    })
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
          expect(ui.onError).toHaveBeenCalledOnce()
        })
      else
        await waitFor(() => {
          expect(ui.getByRole('treeitem', { name: `folder-${String(folder)}` })).toHaveAttribute(
            'aria-expanded',
            'true',
          )
        })
    }
    expect(ui.onError).toHaveBeenCalledWith(new Error(UI_TEXT.nodeErrors.tooLarge))
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
