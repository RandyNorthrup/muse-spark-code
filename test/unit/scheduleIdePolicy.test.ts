import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdeMcpServer } from '../../src/host/ide/ideMcpServer'
import { ideCodeIntelTools } from '../../src/host/ide/codeIntelTools'
import * as codeIntelEntry from '../../src/host/ide/codeIntelEntry'
import { diagnosticsTool } from '../../src/core/diagnostics'
import { ideLegalScanTools } from '../../src/host/ide/legalScanTool'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeLanguageService, loc, sym, renamed, KIND } from './helpers/fakeLanguageService'
import { memoryToolIo } from './helpers/fakeToolIo'
import { unattendedRun } from './helpers/schedules/unattended'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { postLoopbackJson } from './helpers/loopbackHttp'
import { LEGAL_RESULT_VERSION } from '../../src/shared/constants'
import type { McpTool } from '../../src/core/mcp'
import { Usd } from '../../src/shared/usd'
import { legalScanResultSchema } from '../../src/shared/legal'

const root = '/workspace'
const protectedFile = '.muse/hooks.json'
const secret = 'PROTECTED_CONFIG_CONTENT'
const servers: IdeMcpServer[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function call(tools: readonly McpTool[], name: string, args: Record<string, unknown> = {}) {
  const server = new IdeMcpServer(() => tools, new FakeLogOutputChannel())
  servers.push(server)
  const { run } = unattendedRun({
    context: fakeRunContext(
      fakeSchedule({
        grant: {
          rules: tools.map((tool) => ({ id: tool.name, kind: 'tool', name: tool.name })),
          destinationIds: [],
          paidCapUsd: Usd.from(0).toAmount(),
        },
      }),
    ),
  })
  const caller = await server.bindCaller(() => ({ isReady: true, run }))
  const response = await postLoopbackJson(caller.endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  return { response, run }
}

describe('unattended IDE per-file and prompt policy', () => {
  it.each([
    'findDefinition',
    'findReferences',
    'workspaceSymbols',
    'repoMap',
    'callHierarchy',
    'renameSymbol',
    'documentSymbols',
    'hover',
  ])(
    '%s refuses protected content reached through arguments or language-service results',
    async (name) => {
      const io = memoryToolIo({ 'a.ts': 'answer\n', [protectedFile]: secret }, root)
      const symbol = sym(secret, KIND.function, `${root}/${protectedFile}`, 0, 0)
      const service = fakeLanguageService({
        files: io.files,
        definitions: () => [loc(`${root}/${protectedFile}`, 0, 0)],
        references: () => [loc(`${root}/${protectedFile}`, 0, 0)],
        workspace: [symbol],
        calls: () => ({
          item: sym('answer', KIND.function, `${root}/a.ts`, 0, 0),
          calls: [{ symbol, ranges: [symbol.selection] }],
          otherItems: 0,
        }),
        rename: () =>
          Promise.resolve({
            files: [renamed(`${root}/${protectedFile}`, 0, 0)],
            fileOperations: 'none',
          }),
        hover: () => [secret],
        symbols: { [`${root}/${protectedFile}`]: [symbol] },
      })
      const tools = ideCodeIntelTools(
        { service, io, workspaceRoot: root, platform: 'linux', now: () => 0 },
        () => codeIntelEntry,
      )
      let args: Record<string, unknown>
      if (name === 'workspaceSymbols') args = { query: 'CONFIG' }
      else if (name === 'repoMap') args = {}
      else
        args = {
          path: name === 'hover' || name === 'documentSymbols' ? protectedFile : 'a.ts',
          line: 1,
          column: 1,
          ...(name === 'renameSymbol' && { new_name: 'renamed' }),
        }
      const { response, run } = await call(tools, name, args)
      expect(JSON.stringify(response)).not.toContain(secret)
      expect(JSON.stringify(response)).not.toContain(protectedFile)
      expect(run.refusedActions.length).toBeGreaterThan(0)
      expect(service.asked).not.toContain(`open ${root}/${protectedFile}`)
      expect(io.files.get(`${root}/${protectedFile}`)).toBe(secret)
    },
  )

  it.each([{}, { uri: String.raw`.muse\hooks.json` }])(
    'diagnostics checks every returned/read file for %j',
    async (args) => {
      const settleFile = vi.fn(() => Promise.resolve([]))
      const tool = diagnosticsTool({
        workspaceRoot: root,
        platform: 'linux',
        relativeInRoot: (file) => file.slice(root.length + 1).replaceAll('\\', '/'),
        settleFile,
        getDiagnostics: () => [
          {
            path: protectedFile,
            severity: 'error',
            line: 1,
            column: 1,
            message: secret,
            source: undefined,
          },
        ],
      })
      const { response, run } = await call([tool], tool.name, args)
      expect(response).toMatchObject({ result: { isError: true } })
      expect(JSON.stringify(response)).not.toContain(secret)
      expect(settleFile).not.toHaveBeenCalled()
      expect(run.refusedActions).toHaveLength(1)
    },
  )

  it('read-only hints cannot authorize an unattended interactive executor', async () => {
    const prompt = vi.fn(() => Promise.resolve('prompted'))
    const tool: McpTool = {
      name: 'read',
      description: 'read',
      inputSchema: {},
      annotations: { readOnlyHint: true },
      call: prompt,
    }
    const { response, run } = await call([tool], tool.name)
    expect(response).toMatchObject({ result: { isError: true } })
    expect(prompt).not.toHaveBeenCalled()
    expect(run.refusedActions[0]?.reason).toBe(run.modelText.requiresAskingRefused)
  })

  it('legal scan uses its offline executor without a registry disclosure prompt', async () => {
    const offline = legalScanResultSchema.parse({
      version: LEGAL_RESULT_VERSION,
      ruleVersion: '1',
      dataVersion: '1',
      scope: root,
      distribution: 'unknown',
      exclusions: [],
      incompleteChecks: ['registry metadata unavailable'],
      findings: [],
    })
    const prompt = vi.fn(() => Promise.resolve(offline))
    const runUnattendedScan = vi.fn(() => Promise.resolve(offline))
    const tools = ideLegalScanTools({
      isOffered: () => true,
      runScan: prompt,
      runUnattendedScan,
      log: new FakeLogOutputChannel(),
    })
    const { response } = await call(tools, 'legalScan', { paths: ['package.json'] })
    expect(response).toMatchObject({
      result: { content: [{ text: expect.stringContaining('registry metadata unavailable') }] },
    })
    expect(prompt).not.toHaveBeenCalled()
    expect(runUnattendedScan).toHaveBeenCalledOnce()
  })
})
