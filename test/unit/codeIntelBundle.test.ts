// Code intelligence's own bundle (M67, PLAN.md D6): src/host/ide/codeIntelEntry.ts
// built as scripts/build.mjs builds it, then required by `codeIntelLoader`
// with Node's own `require`, as the `ide` server's first code intelligence
// call requires dist/codeIntel.js. The tool list needs no bundle; a call
// that cannot load it is answered with the reason as an error result.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleMcpMessage } from '../../src/core/mcp'
import {
  type CodeIntelBundle,
  codeIntelLoader,
  isCodeIntelBundle,
} from '../../src/host/ide/codeIntelBundle'
import * as codeIntelEntry from '../../src/host/ide/codeIntelEntry'
import { ideCodeIntelTools } from '../../src/host/ide/codeIntelTools'
import {
  CODE_INTEL_BUNDLE_FILE,
  CODE_INTEL_MODEL_TEXT,
  IDE_MCP_SERVER_INFO,
  MODEL_TEXT,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeLanguageService, loc } from './helpers/fakeLanguageService'
import { memoryToolIo } from './helpers/fakeToolIo'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import { logLines } from './helpers/logText'

const built = builtForTests('src/host/ide/codeIntelEntry.ts', CODE_INTEL_BUNDLE_FILE)
// A shorter run of plain text could occur in the bundle by chance.
const MIN_PLAIN_RUN = 12

const ROOT = '/repo'
const MAIN = `${ROOT}/main.ts`
const TOTAL = { start: { line: 0, character: 11 }, end: { line: 0, character: 16 } }

/** A one-file workspace whose service defines `total` on line 1 and renames it there. */
function intelFor() {
  const io = memoryToolIo({ 'main.ts': 'export let total = 1\n' }, ROOT)
  const service = fakeLanguageService({
    files: io.files,
    definitions: () => [loc(MAIN, 0, 11)],
    rename: (_path, _at, newText) =>
      Promise.resolve({
        files: [{ path: MAIN, edits: [{ range: TOTAL, newText }] }],
        fileOperations: 'none' as const,
      }),
  })
  return { service, workspaceRoot: ROOT, platform: 'linux' as const, io, now: () => 0 }
}

/** One `tools/call` as Muse Code sends it, and the server's result. */
async function callTool(name: string, bundle: () => CodeIntelBundle) {
  const params = { name, arguments: { path: 'main.ts', symbol: 'total', new_name: 'sum' } }
  const outcome = await handleMcpMessage(
    JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params }),
    ideCodeIntelTools(intelFor(), bundle),
    IDE_MCP_SERVER_INFO,
  )
  return outcome.kind === 'response' ? outcome.body['result'] : undefined
}

describe('isCodeIntelBundle', () => {
  it('accepts a module that exports the call, and nothing else', () => {
    expect(isCodeIntelBundle({ callCodeIntel: () => Promise.resolve('') })).toBe(true)
    expect(isCodeIntelBundle({ callCodeIntel: 'no' })).toBe(false)
    expect(isCodeIntelBundle({})).toBe(false)
    expect(isCodeIntelBundle(null)).toBe(false)
    expect(isCodeIntelBundle('callCodeIntel')).toBe(false)
  })
})

describe('codeIntelLoader', () => {
  lazyLoaderCases(codeIntelLoader, built, () => MODEL_TEXT.codeIntelUnavailable)
})

/**
 * The longest run of `value` that a bundle writes as it stands: no quote,
 * backslash, `$`, line break or non-ASCII character, which esbuild may
 * escape or wrap differently.
 */
function plainRun(value: string): string {
  let longest = ''
  for (const run of value.split(/[^ -~]|["'`\\$]/u)) {
    if (run.length > longest.length) {
      longest = run
    }
  }
  return longest
}

describe('the shipped code intelligence bundle', () => {
  it('loads the shared English fallback without copying it', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('require("./uiText.js")')
    expect(text).not.toContain(UI_TEXT.crashTitle)
  })

  // One object is carried whole (PLAN.md D6): a read of any MODEL_TEXT key,
  // even one activation reads too, would bring all of it. The bundle reads
  // CODE_INTEL_MODEL_TEXT and FILE_REFUSAL_MODEL_TEXT only.
  it('carries no key and none of the words of MODEL_TEXT', () => {
    const text = readFileSync(built.file, 'utf8')
    // What it does read is found the same way.
    expect(text).toContain(plainRun(CODE_INTEL_MODEL_TEXT.codeIntelNoSymbolNamed))
    for (const [key, value] of Object.entries(MODEL_TEXT)) {
      expect(text, key).not.toMatch(new RegExp(String.raw`(?:^|[\s{,])${key}:`, 'mu'))
      const run = plainRun(value)
      if (run.length >= MIN_PLAIN_RUN) {
        expect(text, key).not.toContain(run)
      }
    }
  })

  it.each(['findDefinition', 'renameSymbol'])(
    'answers %s from the bundle as the source does',
    async (name) => {
      const shipped = codeIntelLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
      const answer = await callTool(name, shipped)
      expect(answer).toEqual(await callTool(name, () => codeIntelEntry))
      expect(answer).toMatchObject({ content: [{ text: expect.stringContaining('total') }] })
      expect(answer).not.toHaveProperty('isError')
    },
  )

  it('answers every call with the reason as an error result while it cannot load, and still lists the tools', async () => {
    const log = new FakeLogOutputChannel()
    const missing = path.join(built.folder, 'gone', CODE_INTEL_BUNDLE_FILE)
    const bundle = codeIntelLoader({ bundlePath: missing, log })
    expect(ideCodeIntelTools(intelFor(), bundle)).toHaveLength(8)
    for (const name of ['findDefinition', 'renameSymbol']) {
      expect(await callTool(name, bundle)).toEqual({
        content: [{ type: 'text', text: MODEL_TEXT.codeIntelUnavailable }],
        isError: true,
      })
    }
    expect(logLines(log).filter((line) => line.includes(missing))).toHaveLength(2)
  })
})
