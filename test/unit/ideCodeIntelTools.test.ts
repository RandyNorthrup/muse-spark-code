// The code intelligence tools on the `ide` server for Muse Code (M67,
// PLAN.md D49): listed with a folder open, each declaring itself read-only
// (MCP annotations), answering as the Model API's tools do, and a rename
// that returns its edits and writes nothing. The answers load with their own
// bundle on the first call (PLAN.md D6, 2026-10-03): listing never loads it,
// and a bundle that cannot load answers as a failed call.

import { describe, expect, it, vi } from 'vitest'
import type { CodeIntelDeps } from '../../src/core/codeIntel/codeIntelQuery'
import { diagnosticsTool } from '../../src/core/diagnostics'
import { handleMcpMessage } from '../../src/core/mcp'
import { codeIntelLoader, type CodeIntelAnswers } from '../../src/host/ide/codeIntelBundle'
import { createCodeIntelAnswers } from '../../src/host/ide/codeIntelEntry'
import { ideCodeIntelTools } from '../../src/host/ide/codeIntelTools'
import { IDE_MCP_SERVER_INFO, MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { fakeLanguageService, loc } from './helpers/fakeLanguageService'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'
const A = `${ROOT}/a.ts`
const FILES = { 'a.ts': 'export const answer = 42\n', 'b.ts': 'answer\n' }

/** The answers as the bundle's factory makes them, from the source modules. */
function sourceAnswers(): CodeIntelAnswers {
  return createCodeIntelAnswers({ uiText: UI_TEXT, uiLocale: uiLocale() })
}

function tools(answers: () => CodeIntelAnswers = sourceAnswers) {
  const io = memoryToolIo(FILES, ROOT)
  const deps: CodeIntelDeps = {
    service: fakeLanguageService({
      files: io.files,
      definitions: () => [loc(A, 0, 13)],
      rename: () =>
        Promise.resolve({
          files: [
            {
              path: A,
              edits: [
                {
                  range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
                  newText: 'result',
                },
              ],
            },
          ],
          fileOperations: 'none' as const,
        }),
    }),
    workspaceRoot: ROOT,
    platform: 'linux',
    io,
    now: () => 0,
  }
  return { io, list: ideCodeIntelTools(deps, answers) }
}

/** A call's JSON-RPC result, or undefined when the server did not answer. */
async function resultOf(name: string, args: Record<string, unknown>) {
  const answered = await call(name, args)
  return answered.body?.['result']
}

async function call(
  name: string,
  args: Record<string, unknown>,
  answers: () => CodeIntelAnswers = sourceAnswers,
) {
  const { io, list } = tools(answers)
  const outcome = await handleMcpMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    list,
    IDE_MCP_SERVER_INFO,
  )
  return { io, body: outcome.kind === 'response' ? outcome.body : undefined }
}

describe('ide code intelligence tools', () => {
  it('lists every tool as read-only, getDiagnostics too, and none without a folder', async () => {
    const answers = vi.fn(sourceAnswers)
    expect(ideCodeIntelTools(undefined, answers)).toEqual([])
    const diagnostics = diagnosticsTool({
      getDiagnostics: () => [],
      workspaceRoot: ROOT,
      platform: 'linux',
      relativeInRoot: () => undefined,
    })
    const outcome = await handleMcpMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      [diagnostics, ...tools(answers).list],
      IDE_MCP_SERVER_INFO,
    )
    // Listing is activation's: the answers' bundle is not loaded for it.
    expect(answers).not.toHaveBeenCalled()
    const listed = outcome.kind === 'response' ? outcome.body['result'] : undefined
    expect(listed).toMatchObject({
      tools: [
        'getDiagnostics',
        'findDefinition',
        'findReferences',
        'workspaceSymbols',
        'documentSymbols',
        'hover',
        'callHierarchy',
        'repoMap',
        'renameSymbol',
      ].map((name) => ({ name, annotations: { readOnlyHint: true } })),
    })
  })

  it('answers as the Model API tools do, and a refusal as an error result', async () => {
    expect(await resultOf('findDefinition', { path: 'b.ts', symbol: 'answer' })).toEqual({
      content: [
        { type: 'text', text: 'Using `answer` at b.ts:1:1.\na.ts:1:14: export const answer = 42' },
      ],
    })
    expect(await resultOf('hover', { path: '../x.ts', line: 1, column: 1 })).toMatchObject({
      content: [{ text: 'path ../x.ts is outside the workspace' }],
      isError: true,
    })
  })

  it('returns a rename as a diff for Muse Code and writes nothing', async () => {
    const { io, body } = await call('renameSymbol', {
      path: 'a.ts',
      symbol: 'answer',
      new_name: 'result',
    })
    expect(body).toMatchObject({
      result: {
        content: [
          {
            text: [
              'The rename of `answer` to `result`: 1 edits in 1 files. This tool changed nothing: apply the diff below with your own edit tool.',
              '--- a/a.ts',
              '+++ b/a.ts',
              '@@ -1,1 +1,1 @@',
              '-export const answer = 42',
              '+export const result = 42',
            ].join('\n'),
          },
        ],
      },
    })
    expect(io.files.get(A)).toBe(FILES['a.ts'])
    expect(
      await resultOf('renameSymbol', { path: 'a.ts', symbol: 'nowhere', new_name: 'x' }),
    ).toMatchObject({ isError: true })
  })

  it('answers every call as a failed one, with the reason, while its bundle cannot be loaded', async () => {
    const log = new FakeLogOutputChannel()
    let isBroken = true
    const answers = codeIntelLoader({
      bundlePath: '/dist/codeIntel.js',
      log,
      loadBundle: () => {
        if (isBroken) throw new Error('Cannot find module')
        return { createCodeIntelAnswers }
      },
    })
    const failed = {
      content: [{ type: 'text', text: MODEL_TEXT.codeIntelUnavailable }],
      isError: true,
    }
    const find = { path: 'b.ts', symbol: 'answer' }
    const read = await call('findDefinition', find, answers)
    expect(read.body).toMatchObject({ result: failed })
    const rename = await call('renameSymbol', { ...find, path: 'a.ts', new_name: 'r' }, answers)
    expect(rename.body).toMatchObject({ result: failed })
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'))
    // The next call tries again.
    isBroken = false
    const retried = await call('findDefinition', find, answers)
    expect(retried.body).toMatchObject({
      result: { content: [{ text: expect.stringContaining('a.ts:1:14') }] },
    })
  })
})
