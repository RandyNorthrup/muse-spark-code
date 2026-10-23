/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { createHash } from 'node:crypto'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EditorView } from 'codemirror'
import { mountNodeWorkspace } from '../../src/webview/node/files/main'
import { NodePageError, validatedNodePort } from '../../src/webview/bridges/nodePort'
import {
  NODE_FILE_TREE_VISIBLE_ROWS,
  NODE_FILE_TREE_OVERSCAN_ROWS,
  NODE_MAX_FILE_BYTES,
  WEBVIEW_L10N_ELEMENT_ID,
  UI_TEXT,
} from '../../src/shared/constants'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'
import { EN } from '../../src/shared/l10n/en'
import { scripted } from './helpers/recordCalls'
import { cleanupNodeUi, mountNodeUi } from './helpers/nodeUi'

// The tests drive the real CodeMirror editor, whose view needs the layout
// primitives jsdom leaves out. These complete the environment (as jsdom
// itself does for the rest of the DOM); they stand in for no product code.
if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class {
      observe(): void {
        /* jsdom has no layout to observe */
      }
      unobserve(): void {
        /* jsdom has no layout to observe */
      }
      disconnect(): void {
        /* jsdom has no layout to observe */
      }
    },
    configurable: true,
    writable: true,
  })
}
for (const key of ['getClientRects', 'getBoundingClientRect'] as const) {
  if (typeof Range.prototype[key] !== 'function') {
    Object.defineProperty(Range.prototype, key, {
      value: key === 'getClientRects' ? () => [] : () => new DOMRect(),
      configurable: true,
      writable: true,
    })
  }
}

// Temporary interposition on real objects, never a module stand-in: jsdom
// leaves out URL.createObjectURL, and the memory-only test must observe
// storage writes without changing them. afterEach restores every wrap.
const restorations: (() => void)[] = []
function wrapMethod(target: object, key: PropertyKey, wrapper: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { value: wrapper, configurable: true, writable: true })
  restorations.push(() => {
    if (descriptor === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, descriptor)
  })
}
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

// Typing drives the real editor through its own transaction API: the same
// document change a keystroke produces, without reimplementing the
// browser's editing engine on top of jsdom.
function editorView(textbox: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(textbox)
  if (view === null) throw new Error('the editor view is missing')
  return view
}
function editorText(textbox: HTMLElement): string {
  return editorView(textbox).state.doc.toString()
}
function setEditorText(textbox: HTMLElement, text: string): void {
  const view = editorView(textbox)
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
async function fixture(hasManyFiles = false) {
  const state = { text: 'original\n', head: 'b'.repeat(40), wrongPath: false }
  const destination = {
    host: 'git.example.invalid',
    port: 22,
    user: 'git',
    repository: 'owner/repo.git',
    hostKeyDigest: 'a'.repeat(64),
  }
  const respond = async (method: NodeMethodName, input: unknown): Promise<unknown> => {
    if (method === 'node/files/list')
      return {
        entries: hasManyFiles
          ? Array.from({ length: 100 }, (_, index) => ({
              path: `file-${String(index)}`,
              kind: 'file',
              sizeBytes: 0,
            }))
          : [
              { path: 'example.txt', kind: 'file', sizeBytes: state.text.length },
              { path: 'second.txt', kind: 'file', sizeBytes: 0 },
            ],
        nextCursor: null,
      }
    if (method === 'node/files/search')
      return {
        entries: [{ path: 'second.txt', kind: 'file', sizeBytes: 0 }],
        nextCursor: null,
      }
    if (method === 'node/files/read')
      return {
        path: state.wrongPath ? 'different.txt' : 'example.txt',
        text: state.text,
        digest: hash(state.text),
      }
    if (method === 'node/files/write') {
      if (
        typeof input !== 'object' ||
        input === null ||
        !('expectedDigest' in input) ||
        !('text' in input) ||
        typeof input.text !== 'string' ||
        input.expectedDigest !== hash(state.text)
      )
        throw new NodePageError('conflict')
      state.text = input.text
      return { digest: hash(state.text) }
    }
    if (method === 'node/git/status')
      return {
        branch: 'refs/heads/main',
        head: state.head,
        changes: [{ path: 'example.txt', kind: 'modified' }],
        nextCursor: null,
        remotes: [{ name: 'origin', destination }],
      }
    if (method === 'node/git/branches')
      return {
        branches: [{ name: 'refs/heads/main', current: true }],
        nextCursor: null,
      }
    if (method === 'node/git/stage') return { done: true }
    return ['node/git/commit', 'node/git/branch', 'node/git/push'].includes(method)
      ? await Promise.resolve({ head: state.head, changed: true })
      : await Promise.reject(new NodePageError('unavailable'))
  }
  const { container, ui, request, verify } = await mountNodeUi(respond)
  await ui.findAllByRole('treeitem')
  return { ui, request, verify, state, container, respond }
}
afterEach(async () => {
  await cleanupNodeUi()
  document.querySelector(`#${WEBVIEW_L10N_ELEMENT_ID}`)?.remove()
  for (const restore of restorations.splice(0).toReversed()) restore()
  if (cryptoDescriptor === undefined) Reflect.deleteProperty(globalThis, 'crypto')
  else Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
})

type WorkspaceFixture = Awaited<ReturnType<typeof fixture>>
function beginPendingOpen({ ui, request }: Pick<WorkspaceFixture, 'ui' | 'request'>): {
  resolve: (value: unknown) => void
  pendingSignal: () => AbortSignal | undefined
} {
  const pending = Promise.withResolvers<unknown>()
  let pendingSignal: AbortSignal | undefined
  request.once((_method, _input, signal) => {
    pendingSignal = signal
    return pending.promise
  })
  fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
  return {
    resolve: (value: unknown) => {
      pending.resolve(value)
    },
    pendingSignal: () => pendingSignal,
  }
}
async function settleLateReply(
  ui: WorkspaceFixture['ui'],
  opened: ReturnType<typeof beginPendingOpen>,
): Promise<void> {
  await act(async () => {
    opened.resolve({ path: 'example.txt', text: 'late', digest: hash('late') })
    await Promise.resolve()
  })
  expect(ui.queryByRole('textbox', { name: UI_TEXT.nodeLabels.editor })).toBeNull()
}

describe('M110-U1 shared workspace UI', () => {
  it.each([
    { locale: 'bad_locale', table: EN },
    {
      locale: 'en',
      table: { ...EN, nodeWorkspace: { ...EN.nodeWorkspace, networkConfirm: 'Wrong {slot}' } },
    },
  ])('refuses a language table with invalid locale or template before mount', async (input) => {
    const { request, verify } = await fixture()
    request.reset()
    const embedded = document.createElement('script')
    embedded.type = 'application/json'
    embedded.id = WEBVIEW_L10N_ELEMENT_ID
    embedded.textContent = JSON.stringify(input)
    document.head.append(embedded)
    // The mount throws before returning a disposer; the detached div
    // takes nothing with it.
    expect(() => {
      mountNodeWorkspace(document.createElement('div'), {
        workspaceId: 'repo',
        port: validatedNodePort({ request }),
        auth: { verify },
        connectTerminal: () => Promise.reject(new NodePageError('unavailable')),
      })
    }).toThrow()
    expect(request.calls).toHaveLength(0)
  })
  it('H10 refuses a file response naming a different path before opening the editor', async () => {
    const { ui, state } = await fixture()
    state.wrongPath = true
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
    expect(ui.queryByRole('textbox', { name: UI_TEXT.nodeLabels.editor })).toBeNull()
  })
  it('H08 serializes file requests and discards a reply after the person cancels', async () => {
    const { ui, request } = await fixture()
    const opened = beginPendingOpen({ ui, request })
    fireEvent.click(ui.getByRole('treeitem', { name: 'second.txt' }))
    expect(request.calls.filter(([method]) => method === 'node/files/read')).toHaveLength(1)
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.gitCancel }))
    expect(opened.pendingSignal()?.aborted).toBe(true)
    await settleLateReply(ui, opened)
    expect(ui.queryByRole('alert')).toBeNull()
  })
  it('H08 keeps the single-flight lock after cancel until the aborted request settles', async () => {
    const { ui, request } = await fixture()
    const opened = beginPendingOpen({ ui, request })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.gitCancel }))
    // A second request before the first settles must not start: the
    // aborted call may still be applied on the server.
    fireEvent.click(ui.getByRole('treeitem', { name: 'second.txt' }))
    expect(request.calls.filter(([method]) => method === 'node/files/read')).toHaveLength(1)
    expect(ui.getByRole('button', { name: UI_TEXT.gitCancel })).toBeInTheDocument()
    await settleLateReply(ui, opened)
    // Once the aborted request settles the lock is free again.
    fireEvent.click(ui.getByRole('treeitem', { name: 'second.txt' }))
    expect(request.calls.filter(([method]) => method === 'node/files/read')).toHaveLength(2)
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
  })
  it('opens, edits and saves with the original digest and keeps editor input through rerenders', async () => {
    const { ui, request, state } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    const editor = await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    setEditorText(editor, 'edited\n')
    expect(editorText(editor)).toBe('edited\n')
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.save }))
    await ui.findByText(UI_TEXT.nodeWorkspace.saved)
    expect(request.calls.find(([method]) => method === 'node/files/write')?.[1]).toEqual({
      workspaceId: 'repo',
      path: 'example.txt',
      expectedDigest: hash('original\n'),
      text: 'edited\n',
    })
    expect(state.text).toBe('edited\n')
  })
  it('H10 retains unsaved edits when another file is requested and after a stale save refuses', async () => {
    const { ui, state, request } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    const editor = await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    setEditorText(editor, 'my edit')
    fireEvent.click(ui.getByRole('treeitem', { name: 'second.txt' }))
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeWorkspace.unsaved)
    expect(request.calls.filter(([method]) => method === 'node/files/read')).toHaveLength(1)
    state.text = 'competing edit'
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.save }))
    await waitFor(() => {
      expect(ui.getByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
    })
    expect(editorText(editor)).toBe('my edit')
    expect(state.text).toBe('competing edit')
  })
  it('reviews saved and edited text, then discards explicitly', async () => {
    const { ui, container } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    setEditorText(await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor }), 'changed')
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.diff }))
    // The real side-by-side diff renders each revision in its own pane.
    await waitFor(() => {
      expect(container.querySelector('.node-diff')?.textContent).toContain('original')
    })
    expect(container.querySelector('.node-diff')?.textContent).toContain('changed')
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.discard }))
    expect(editorText(await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor }))).toBe(
      'original\n',
    )
  })
  it('preserves typing performed while a save is pending', async () => {
    const { ui, request, state } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    const editor = await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    setEditorText(editor, 'saved snapshot')
    const { promise, resolve: finish } = Promise.withResolvers<unknown>()
    request.once(() => promise)
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.save }))
    setEditorText(editor, 'further typing')
    state.text = 'saved snapshot'
    await act(async () => {
      finish({ digest: hash(state.text) })
      await Promise.resolve()
    })
    await ui.findByText(UI_TEXT.nodeWorkspace.saved)
    expect(editorText(editor)).toBe('further typing')
    expect(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.save })).toBeEnabled()
  })
  it('H09 refuses an oversized upload before allocating its bytes', async () => {
    const { ui, request } = await fixture()
    const file = new File([], 'big.txt')
    const arrayBuffer = scripted<[], Promise<ArrayBuffer>>(() =>
      Promise.resolve(new ArrayBuffer(0)),
    )
    Object.defineProperties(file, {
      size: { value: NODE_MAX_FILE_BYTES + 1 },
      arrayBuffer: { value: arrayBuffer },
    })
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), { target: { files: [file] } })
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.tooLarge)
    expect(arrayBuffer.calls).toHaveLength(0)
    expect(request.calls.some(([method]) => method === 'node/files/upload')).toBe(false)
  })
  it('H10 refuses an upload over an unsaved buffer without reading the selected file', async () => {
    const { ui } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    setEditorText(await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor }), 'unsaved')
    const file = new File([], 'replacement.txt')
    const arrayBuffer = scripted<[], Promise<ArrayBuffer>>(() =>
      Promise.resolve(new ArrayBuffer(0)),
    )
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), { target: { files: [file] } })
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
    expect(arrayBuffer.calls).toHaveLength(0)
  })
  it('reloads the open buffer and digest after an upload over the open file', async () => {
    const { ui, request, state, respond } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    request.use((method, input) => {
      if (
        method === 'node/files/upload' &&
        typeof input === 'object' &&
        input !== null &&
        'data' in input
      ) {
        state.text = Buffer.from(String(input.data), 'base64').toString('utf8')
        return Promise.resolve({ digest: hash(state.text) })
      }
      return respond(method, input)
    })
    const file = new File(['uploaded bytes\n'], 'example.txt')
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), { target: { files: [file] } })
    await ui.findByText(UI_TEXT.nodeWorkspace.saved)
    // The editor shows the uploaded bytes and Save rests: the draft is
    // clean against the reloaded digest, not the stale one.
    expect(editorText(ui.getByRole('textbox', { name: UI_TEXT.nodeLabels.editor }))).toBe(
      'uploaded bytes\n',
    )
    expect(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.save })).toBeDisabled()
    setEditorText(
      ui.getByRole('textbox', { name: UI_TEXT.nodeLabels.editor }),
      'uploaded bytes\nedited',
    )
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.save }))
    await waitFor(() => {
      expect(state.text).toBe('uploaded bytes\nedited')
    })
  })
  it('closes the open buffer with a clear notice after a non-UTF-8 upload over it', async () => {
    const { ui, request, respond } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    let isBinary = false
    request.use((method, input) => {
      if (method === 'node/files/upload') {
        // The server stores the raw bytes; the follow-up read cannot
        // decode them, exactly like a typed notText refusal.
        isBinary = true
        return Promise.resolve({ digest: hash('binary') })
      }
      return method === 'node/files/read' && isBinary
        ? Promise.reject(new NodePageError('notText'))
        : respond(method, input)
    })
    const file = new File([new Uint8Array([255])], 'example.txt')
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), { target: { files: [file] } })
    await ui.findByText(UI_TEXT.nodeWorkspace.binaryReplaced)
    // The buffer is closed, not left on stale bytes: no editor, no Save,
    // and the typed notice instead of "unavailable".
    expect(ui.queryByRole('textbox', { name: UI_TEXT.nodeLabels.editor })).toBeNull()
    expect(ui.queryByRole('alert')).toBeNull()
    expect(request.calls.some(([method]) => method === 'node/files/upload')).toBe(true)
  })
  it('accepts a later upload to the same path after a non-UTF-8 upload closes the buffer', async () => {
    const { ui, request, state, respond } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    let uploads = 0
    request.use((method, input) => {
      if (
        method === 'node/files/upload' &&
        typeof input === 'object' &&
        input !== null &&
        'data' in input
      ) {
        uploads += 1
        // The first upload stores non-UTF-8 bytes, so the follow-up
        // read cannot decode them; the second stores UTF-8 text.
        if (uploads > 1) state.text = Buffer.from(String(input.data), 'base64').toString('utf8')
        return Promise.resolve({ digest: hash(uploads === 1 ? 'binary' : state.text) })
      }
      return method === 'node/files/read' && uploads === 1
        ? Promise.reject(new NodePageError('notText'))
        : respond(method, input)
    })
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), {
      target: { files: [new File([new Uint8Array([255])], 'example.txt')] },
    })
    await ui.findByText(UI_TEXT.nodeWorkspace.binaryReplaced)
    expect(ui.queryByRole('textbox', { name: UI_TEXT.nodeLabels.editor })).toBeNull()
    // The closed buffer no longer answers for the boxed path, so the
    // box is cleared and a later upload is not refused as a conflict.
    expect(ui.getByRole('textbox', { name: UI_TEXT.nodeWorkspace.path })).toHaveValue('')
    // No editing of the path box: the replacement targets the upload's
    // own name and must reach the server.
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), {
      target: { files: [new File(['recovered\n'], 'example.txt')] },
    })
    await ui.findByText(UI_TEXT.nodeWorkspace.saved)
    expect(ui.queryByRole('alert')).toBeNull()
    expect(request.calls.filter(([method]) => method === 'node/files/upload')).toHaveLength(2)
    expect(state.text).toBe('recovered\n')
  })
  it('refuses an upload over the open file with a cleared path box while edits are unsaved', async () => {
    const { ui, request } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    const editor = await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    setEditorText(editor, 'unsaved')
    // Clearing the path box retargets the upload at the open file by
    // name; the unsaved-draft guard must still refuse it.
    fireEvent.change(ui.getByRole('textbox', { name: UI_TEXT.nodeWorkspace.path }), {
      target: { value: '' },
    })
    const file = new File(['replacement'], 'example.txt')
    fireEvent.change(ui.getByLabelText(UI_TEXT.nodeLabels.upload), { target: { files: [file] } })
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
    expect(request.calls.some(([method]) => method === 'node/files/upload')).toBe(false)
  })
  it('H10 refuses a download whose digest does not describe its bytes', async () => {
    const { ui, request } = await fixture()
    fireEvent.click(ui.getByRole('treeitem', { name: 'example.txt' }))
    await ui.findByRole('textbox', { name: UI_TEXT.nodeLabels.editor })
    // jsdom leaves out createObjectURL; the refusal must fire before
    // any object URL is minted, so the recorder must stay empty.
    const createdObjectUrls: unknown[] = []
    wrapMethod(URL, 'createObjectURL', (blob: Blob) => {
      createdObjectUrls.push(blob)
      return 'blob:fixture'
    })
    wrapMethod(URL, 'revokeObjectURL', (_url: string) => {
      /* the fixture mints no URL, so nothing is revoked */
    })
    request.once(() => Promise.resolve({ data: btoa('bytes'), digest: hash('different') }))
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.download }))
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
    expect(createdObjectUrls).toHaveLength(0)
  })
  it('H09 virtualizes the tree while keyboard Home/End keeps the active row mounted', async () => {
    const { ui } = await fixture(true)
    const tree = ui.getByRole('tree')
    expect(ui.getAllByRole('treeitem').length).toBeLessThanOrEqual(
      NODE_FILE_TREE_VISIBLE_ROWS + NODE_FILE_TREE_OVERSCAN_ROWS * 2,
    )
    fireEvent.keyDown(tree, { key: 'End' })
    expect(ui.getByRole('treeitem', { name: 'file-99' })).toHaveAttribute('aria-selected', 'true')
    expect(tree.querySelector('[aria-selected="true"]')?.id).toBe(
      tree.getAttribute('aria-activedescendant'),
    )
    fireEvent.keyDown(tree, { key: 'Home' })
    expect(ui.getByRole('treeitem', { name: 'file-0' })).toHaveAttribute('aria-selected', 'true')
  })
  it('searches filenames through the shared method and preserves memory-only page state', async () => {
    const actualSetItem = Storage.prototype.setItem
    let storageWrites = 0
    wrapMethod(Storage.prototype, 'setItem', function (this: Storage, key: string, value: string) {
      storageWrites += 1
      Reflect.apply(actualSetItem, this, [key, value])
    })
    const { ui, request } = await fixture()
    fireEvent.change(ui.getByRole('textbox', { name: UI_TEXT.nodeWorkspace.search }), {
      target: { value: 'second' },
    })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.search }))
    await waitFor(() => {
      expect(ui.getAllByRole('treeitem')).toHaveLength(1)
    })
    expect(request.calls.some(([method]) => method === 'node/files/search')).toBe(true)
    expect(storageWrites).toBe(0)
    expect(document.cookie).toBe('')
  })
  it('H14 shows the entire verified destination and asks before credentialed dispatch', async () => {
    const { ui, request, verify } = await fixture()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.git }))
    await ui.findByText('git@git.example.invalid:22/owner/repo.git')
    expect(ui.getByText('a'.repeat(64))).toBeInTheDocument()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.gitPushAction }))
    expect(verify.calls).toHaveLength(0)
    expect(request.calls.some(([method]) => method === 'node/git/push')).toBe(false)
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.stepUp }))
    await waitFor(() => {
      expect(request.calls.some(([method]) => method === 'node/git/push')).toBe(true)
    })
    expect(verify.calls).toHaveLength(1)
  })
  it('H14 refuses a branch changed during verification in the actual page', async () => {
    const { ui, request, verify, state } = await fixture()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.git }))
    await ui.findByText('git@git.example.invalid:22/owner/repo.git')
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.gitPushAction }))
    verify.once((action, actionDigest) => {
      state.head = 'c'.repeat(40)
      return Promise.resolve({
        id: 'proof',
        sessionId: 'session',
        action,
        actionDigest,
        verifiedAt: 1,
        expiresAt: 2,
      })
    })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.stepUp }))
    expect(await ui.findByRole('alert')).toHaveTextContent(UI_TEXT.nodeErrors.conflict)
    expect(request.calls.some(([method]) => method === 'node/git/push')).toBe(false)
  })
  it('appends git change and branch pages instead of replacing the visible list', async () => {
    const { ui, request, state, respond } = await fixture()
    const destination = {
      host: 'git.example.invalid',
      port: 22,
      user: 'git',
      repository: 'owner/repo.git',
      hostKeyDigest: 'a'.repeat(64),
    }
    request.use((method, input) => {
      const cursor =
        typeof input === 'object' &&
        input !== null &&
        'cursor' in input &&
        typeof input.cursor === 'string'
          ? input.cursor
          : null
      if (method === 'node/git/status')
        return Promise.resolve({
          branch: 'refs/heads/main',
          head: state.head,
          changes: [{ path: cursor === null ? 'a.txt' : 'b.txt', kind: 'modified' }],
          nextCursor: cursor === null ? 'page-1' : null,
          remotes: [{ name: 'origin', destination }],
        })
      if (method === 'node/git/branches')
        return Promise.resolve({
          branches: [
            {
              name: cursor === null ? 'refs/heads/main' : 'refs/heads/other',
              current: cursor === null,
            },
          ],
          nextCursor: cursor === null ? 'page-1' : null,
        })
      return respond(method, input)
    })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.git }))
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.refresh }))
    await ui.findByText('a.txt')
    const [statusMore] = await ui.findAllByRole('button', { name: UI_TEXT.shareShowMore })
    if (statusMore === undefined) throw new Error('status Show more is missing')
    fireEvent.click(statusMore)
    await ui.findByText('b.txt')
    // The first change page must stay: Show more appends like the
    // directory tree instead of replacing the visible list.
    expect(ui.getByText('a.txt')).toBeInTheDocument()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.shareShowMore }))
    await ui.findByText('refs/heads/other')
    expect(ui.getAllByText('refs/heads/main').length).toBeGreaterThan(1)
  })
})
