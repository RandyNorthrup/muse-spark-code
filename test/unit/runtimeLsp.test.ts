import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { lspHarness, initialize } from './helpers/lspClient'
import { lspTransport } from '../../src/runtime/lsp/transport'
import { documentOffset, LspDocuments, rangeOffsets } from '../../src/runtime/lsp/documents'
import type { Suggestion } from '../../src/runtime/lsp/protocol'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import type { LspServices } from '../../src/runtime/lsp/server'
import { UI_TEXT, LSP_LIMITS } from '../../src/shared/constants'

const workspace = process.cwd()
const uri = pathToFileURL(`${workspace}/sample.ts`).href
const position = { line: 0, character: 2 }
const range = { start: position, end: position }
const baseServices: LspServices = {
  trusted: true,
  supportsReview: true,
  permitsSuggestedEdit: () => Promise.resolve(true),
  complete: () => Promise.resolve('π\n'),
  command: (command) => Promise.resolve(command),
}
const reviewSuggestion = {
  uri,
  version: 1,
  contentHash: createHash('sha256').update('🙂').digest('hex'),
  diagnostic: { range, message: 'review' },
  edit: { range, newText: 'edit' },
} satisfies Suggestion
function open(client: ReturnType<typeof lspHarness>['client'], text = '🙂', version = 1) {
  client.notify('textDocument/didOpen', {
    textDocument: { uri, version, languageId: 'typescript', text },
  })
}
function change(
  client: ReturnType<typeof lspHarness>['client'],
  version: number,
  text = 'changed',
) {
  client.notify('textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: [{ text }],
  })
}
function complete(client: ReturnType<typeof lspHarness>['client'], isInline = false) {
  return client.request(isInline ? 'textDocument/inlineCompletion' : 'textDocument/completion', {
    textDocument: { uri },
    position,
  })
}

describe('LSP argv admission', () => {
  it('keeps Tab off and requires explicit contributor and trust flags', () => {
    expect(parseCommandLine(['lsp'])).toMatchObject({
      command: 'lsp',
      options: { tabOn: false, trustWorkspace: false, tabBudgetUsd: 1 },
    })
    expect(parseCommandLine(['lsp', '--tab', '--trust-workspace'])).toMatchObject({
      command: 'lsp',
      options: { tabOn: true, trustWorkspace: true },
    })
    expect(parseCommandLine(['lsp', '--tab-model', 'muse-spark-1.3-contributor']).command).toBe(
      'invalid',
    )
    expect(
      parseCommandLine([
        'lsp',
        '--tab-model',
        'muse-spark-1.3-contributor',
        '--allow-contributor-models',
      ]).command,
    ).toBe('lsp')
    for (const value of ['0', '-1', '0.01', '51', 'NaN', 'Infinity', ''])
      expect(parseCommandLine(['lsp', '--tab-daily-budget-usd', value]).command).toBe('invalid')
    expect(parseCommandLine(['lsp', '--bogus']).command).toBe('invalid')
    expect(parseCommandLine(['stop', '--backend', 'museCode', '--trust-workspace']).command).toBe(
      'stop',
    )
    expect(parseCommandLine(['stop', '--bogus']).command).toBe('invalid')
  })
})

describe('M104L LSP client conformance', () => {
  it('passes request cancellation to the controller service', async () => {
    const held = Promise.withResolvers<unknown>()
    const entered = Promise.withResolvers<AbortSignal>()
    const run = lspHarness(workspace, {
      ...baseServices,
      command: (_command, _document, _range, _client, signal) => {
        entered.resolve(signal)
        return held.promise
      },
    })
    try {
      await initialize(run.client)
      const pending = Promise.allSettled([
        run.client.request('workspace/executeCommand', { command: 'muse.help' }),
      ])
      const signal = await entered.promise
      run.client.notify('$/cancelRequest', { id: 'server-2' })
      await Promise.resolve()
      expect(signal.aborted).toBe(true)
      held.resolve(null)
      expect(await pending).toEqual([
        { status: 'rejected', reason: expect.objectContaining({ message: 'ELSP_CLIENT' }) },
      ])
    } finally {
      held.resolve(null)
      run.close()
    }
  })
  it.each([false, true])(
    'negotiates isInline=%s and returns byte-exact Unicode completions',
    async (isInline) => {
      const run = lspHarness(workspace, baseServices)
      try {
        expect(await initialize(run.client, isInline)).toMatchObject({
          capabilities: {
            positionEncoding: 'utf-16',
            completionProvider: { resolveProvider: false },
            ...(isInline && { inlineCompletionProvider: true }),
          },
        })
        open(run.client)
        if (!isInline) await expect(complete(run.client, true)).rejects.toThrow('ELSP_CLIENT')
        expect(await complete(run.client, isInline)).toEqual(
          isInline
            ? { items: [{ insertText: 'π\n', range }] }
            : [
                {
                  label: UI_TEXT.paidTabName,
                  kind: 1,
                  insertTextFormat: 1,
                  textEdit: { range, newText: 'π\n' },
                  detail: UI_TEXT.paidTabName,
                },
              ],
        )
        if (isInline)
          expect(await complete(run.client)).toMatchObject([{ textEdit: { newText: 'π\n' } }])
        expect(await run.client.request('shutdown', {})).toBeNull()
        run.client.notify('exit', {})
        await run.server.closed
      } finally {
        run.close()
      }
    },
  )
  it('rejects requests before initialization and unsupported position encoding', async () => {
    const run = lspHarness(workspace, baseServices)
    try {
      await expect(complete(run.client)).rejects.toThrow('ELSP_CLIENT')
      await expect(
        run.client.request('initialize', {
          capabilities: { general: { positionEncodings: [['utf', '8'].join('-')] } },
        }),
      ).rejects.toThrow('ELSP_CLIENT')
      await initialize(run.client)
      open(run.client)
      await expect(complete(run.client, true)).rejects.toThrow('ELSP_CLIENT')
    } finally {
      run.close()
    }
  })
  it('drops a stale completion and handles Stop while completion is busy', async () => {
    const { promise: waiting, resolve: finish } = Promise.withResolvers<string | undefined>()
    const run = lspHarness(workspace, { ...baseServices, complete: () => waiting })
    try {
      await initialize(run.client)
      open(run.client)
      const suggestion = complete(run.client)
      change(run.client, 2)
      expect(await run.client.request('workspace/executeCommand', { command: 'muse.stop' })).toBe(
        'muse.stop',
      )
      finish('old')
      expect(await suggestion).toEqual([])
    } finally {
      finish(undefined)
      run.close()
    }
  })
  it('version-checks diagnostics, prompts before edits and sends one versioned workspace edit', async () => {
    let publish: (items: readonly Suggestion[]) => void = vi.fn()
    const run = lspHarness(workspace, {
      ...baseServices,
      subscribe: (listener) => {
        publish = listener
        return vi.fn()
      },
    })
    const suggestion = {
      ...reviewSuggestion,
      diagnostic: {
        ...reviewSuggestion.diagnostic,
        severity: 2,
        message: 'authored review fixture',
      },
      edit: { range, newText: 'fixed' },
    }
    let prompts = 0
    let edits = 0
    run.answer((message, client) => {
      if (message.id === undefined || message.id === null) return
      if (message.method === 'window/showMessageRequest') {
        prompts += 1
        client.reply(message.id, { title: UI_TEXT.lspApply })
      } else if (message.method === 'workspace/applyEdit') {
        edits += 1
        expect(message.params).toEqual({
          label: UI_TEXT.lspApply,
          edit: {
            documentChanges: [{ textDocument: { uri, version: 1 }, edits: [suggestion.edit] }],
          },
        })
        client.reply(message.id, { applied: true })
      }
    })
    try {
      await initialize(run.client)
      open(run.client)
      publish([suggestion])
      expect(run.messages).toContainEqual({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, version: 1, diagnostics: [suggestion.diagnostic] },
      })
      const actions = await run.client.request('textDocument/codeAction', {
        textDocument: { uri },
        range,
        context: { diagnostics: [] },
      })
      expect(actions).toHaveLength(3)
      expect(
        await run.client.request('workspace/executeCommand', {
          command: 'muse.apply',
          arguments: [suggestion],
        }),
      ).toBe(true)
      expect({ prompts, edits }).toEqual({ prompts: 1, edits: 1 })
      await expect(
        run.client.request('workspace/executeCommand', {
          command: 'muse.apply',
          arguments: [suggestion],
        }),
      ).rejects.toThrow('ELSP_CLIENT')
      change(run.client, 2)
      publish([suggestion])
      expect(run.messages.at(-1)?.params).toEqual({ uri, version: 2, diagnostics: [] })
    } finally {
      run.close()
    }
  })
  it.each([
    'deny',
    'changed',
    'unsupported',
    'untrusted',
    'policy',
    'absentPolicy',
    'policyChanged',
  ])('never edits when %s', async (reason) => {
    let publish: (items: readonly Suggestion[]) => void = vi.fn()
    const run = lspHarness(workspace, {
      ...baseServices,
      trusted: reason !== 'untrusted',
      permitsSuggestedEdit:
        reason === 'absentPolicy'
          ? undefined
          : vi
              .fn<NonNullable<LspServices['permitsSuggestedEdit']>>()
              .mockResolvedValueOnce(reason !== 'policy')
              .mockResolvedValue(reason !== 'policyChanged'),
      subscribe: (listener) => {
        publish = listener
        return vi.fn()
      },
    })
    const suggestion = reviewSuggestion
    const edit = vi.fn()
    run.answer((message, client) => {
      if (message.id === undefined || message.id === null) return
      if (message.method === 'window/showMessageRequest') {
        if (reason === 'changed') change(client, 2)
        client.reply(message.id, reason === 'deny' ? null : { title: UI_TEXT.lspApply })
      } else {
        edit()
        client.reply(message.id, { applied: true })
      }
    })
    try {
      await initialize(run.client, false, reason !== 'unsupported')
      open(run.client)
      publish([suggestion])
      const pending = run.client.request('workspace/executeCommand', {
        command: 'muse.apply',
        arguments: [suggestion],
      })
      if (reason === 'unsupported' || reason === 'untrusted')
        await expect(pending).rejects.toThrow('ELSP_CLIENT')
      else expect(await pending).toBe(false)
      expect(edit).not.toHaveBeenCalled()
    } finally {
      run.close()
    }
  })
  it('refuses forged edits and stale selections, and clears closed-document diagnostics', async () => {
    const commands = vi.fn(() => Promise.resolve(null))
    const run = lspHarness(workspace, { ...baseServices, command: commands })
    try {
      await initialize(run.client)
      open(run.client)
      await expect(
        run.client.request('workspace/executeCommand', {
          command: 'muse.apply',
          arguments: [
            {
              uri,
              version: 1,
              contentHash: createHash('sha256').update('🙂').digest('hex'),
              diagnostic: { range, message: 'forged' },
              edit: { range, newText: 'forged' },
            },
          ],
        }),
      ).rejects.toThrow()
      await expect(
        run.client.request('workspace/executeCommand', {
          command: 'muse.fix',
          arguments: [uri, 0, range],
        }),
      ).rejects.toThrow()
      expect(commands).not.toHaveBeenCalled()
      run.client.notify('textDocument/didClose', { textDocument: { uri } })
      await expect(complete(run.client)).rejects.toThrow()
      expect(run.messages.at(-1)?.params).toEqual({ uri, diagnostics: [] })
    } finally {
      run.close()
    }
  })
})

describe('bounded LSP framing and document validation', () => {
  it('accepts fragmented and coalesced byte frames and rejects malformed UTF-8 JSON', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received = vi.fn()
    const chunks: Buffer[] = []
    output.on('data', (bytes: Buffer) => {
      chunks.push(bytes)
    })
    const transport = lspTransport(input, output, received)
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'test', params: '🙂' }))
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${String(body.length)}\r\n\r\n`),
      body,
    ])
    try {
      for (const byte of frame) input.write(Buffer.from([byte]))
      input.write(Buffer.concat([frame, frame]))
      expect(received).toHaveBeenCalledTimes(3)
      input.write(Buffer.concat([Buffer.from('Content-Length: 1\r\n\r\n'), Buffer.from([255])]))
      expect(Buffer.concat(chunks).toString()).toContain('ELSP_JSON')
    } finally {
      transport.close()
      input.destroy()
      output.destroy()
    }
  })
  it('accepts null-id protocol errors without echoing them and rejects mixed RPC shapes', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const receive = vi.fn()
    const bytes: Buffer[] = []
    output.on('data', (chunk: Buffer) => {
      bytes.push(chunk)
    })
    const transport = lspTransport(input, output, receive)
    try {
      const valid = Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32_700, message: 'parse error' },
        }),
      )
      input.write(
        Buffer.concat([Buffer.from(`Content-Length: ${String(valid.length)}\r\n\r\n`), valid]),
      )
      expect(bytes).toEqual([])
      const invalid = Buffer.from(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'mixed', result: null }),
      )
      input.write(
        Buffer.concat([Buffer.from(`Content-Length: ${String(invalid.length)}\r\n\r\n`), invalid]),
      )
      expect(Buffer.concat(bytes).toString()).toContain('ELSP_MESSAGE')
      expect(receive).not.toHaveBeenCalled()
    } finally {
      transport.close()
      input.destroy()
      output.destroy()
    }
  })
  it.each([
    `Content-Length: ${String(LSP_LIMITS.frameBytes + 1)}\r\n\r\n`,
    'Content-Length: 1\r\nContent-Length: 1\r\n\r\n',
    'x'.repeat(LSP_LIMITS.headerBytes + 1),
  ])('closes on over-cap/ambiguous framing', async (frame) => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = lspTransport(input, output, vi.fn())
    let didClose = false
    void transport.closed.then(() => {
      didClose = true
    })
    try {
      input.write(frame)
      await Promise.resolve()
      expect(didClose).toBe(true)
    } finally {
      transport.close()
      input.destroy()
      output.destroy()
    }
  })
  it('bounds document state independently of rejected URI leases', () => {
    const docs = new LspDocuments(workspace)
    for (let index = 0; index < LSP_LIMITS.documentCount; index += 1)
      docs.put({
        uri: pathToFileURL(`${workspace}/cap-${String(index)}.ts`).href,
        version: 1,
        languageId: 'typescript',
        text: 'x',
      })
    expect(() => {
      docs.put({ uri, version: 1, languageId: 'typescript', text: 'x' })
    }).toThrow('ELSP_DOCUMENTS')
  })
  it('rejects oversized docs, traversal, stale versions and invalid UTF-16 ranges', () => {
    const docs = new LspDocuments(workspace)
    const document = { uri, version: 1, text: '🙂\r\nabc', languageId: 'typescript' }
    docs.put(document)
    expect(documentOffset(document.text, { line: 1, character: 2 })).toBe(6)
    expect(() => {
      docs.put(document)
    }).toThrow('ELSP_VERSION')
    expect(() => {
      docs.put({ ...document, version: 2, text: 'x'.repeat(LSP_LIMITS.documentBytes + 1) })
    }).toThrow('ELSP_DOCUMENT_SIZE')
    expect(() => {
      docs.put({ ...document, uri: 'file:///outside.ts' })
    }).toThrow('ELSP_ROOT')
    expect(() => docs.signal('file:///outside.ts')).toThrow('ELSP_DOCUMENT_CLOSED')
    expect(() => documentOffset(document.text, { line: 0, character: 3 })).toThrow('ELSP_POSITION')
    expect(() =>
      rangeOffsets('ab', { start: { line: 0, character: 2 }, end: { line: 0, character: 1 } }),
    ).toThrow('ELSP_RANGE')
  })
})
