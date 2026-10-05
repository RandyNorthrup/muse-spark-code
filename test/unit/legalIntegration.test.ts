import manifest from '../../package.json'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runLegalScan } from '../../src/host/ide/legalScanEntry'
import { ideLegalScanTools } from '../../src/host/ide/legalScanTool'
import { runLegalScanCall } from '../../src/core/backends/modelapi/legalScanTool'
import { createLegalSnapshot, scanLegal } from '../../src/core/legal'
import { createLogger } from '../../src/host/logger'
import { FakeLogOutputChannel } from './helpers/fakes'
import { legalScanResultSchema } from '../../src/shared/legal'
import { runLegalCommand, legalReportEnvelopeSchema } from '../../src/runtime/legal/runLegal'
import { COMMAND_IDS, UI_TEXT } from '../../src/shared/constants'

const workspaceRoot = path.resolve('test/fixtures/legal/tree')

describe('M97 real scanner integration', () => {
  it('returns identical deterministic facts through native, MCP and headless adapters', async () => {
    const signal = new AbortController().signal
    const input = { headerPolicy: 'required' } as const
    const expected = scanLegal(createLegalSnapshot(workspaceRoot), input)
    const runner = async () => {
      const handle = await runLegalScan({ workspaceRoot, input, signal })
      return handle.result
    }
    const native = await runLegalScanCall(input, runner, true, signal)
    expect(native.ok).toBe(true)
    if (!native.ok) throw new Error(native.reason)
    expect(legalScanResultSchema.parse(JSON.parse(native.json))).toEqual(expected)
    const [tool] = ideLegalScanTools({
      isOffered: () => true,
      runScan: runner,
      log: createLogger(new FakeLogOutputChannel()),
    })
    if (tool === undefined) throw new Error('missing legal scan adapter')
    expect(legalScanResultSchema.parse(JSON.parse(await tool.call(input, signal)))).toEqual(
      expected,
    )
    const headless = await runLegalCommand({
      options: { format: 'json', out: undefined, registry: false },
      deps: {
        scan: () => runLegalScan({ workspaceRoot, input, signal }),
        fetch: () => {
          throw new Error('offline scan must not fetch')
        },
        writeFile: () => {
          throw new Error('unrequested export')
        },
      },
    })
    expect(legalReportEnvelopeSchema.parse(JSON.parse(headless.out)).result).toEqual(expected)
  })

  it('contributes the deterministic command beside the slash entry', () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: COMMAND_IDS.legalScan,
      title: '%command.legalScan.title%',
      category: '%command.category%',
    })
    const source = readFileSync('src/extension.ts', 'utf8')
    expect(source).toMatch(
      /COMMAND_IDS\.legalScan,\s*forActiveConversation\(\(controller\) => controller\.handle\(\{ type: 'requestLegalScan' \}\)\)/,
    )
  })

  it('refuses invalid inputs and cancellation before workspace admission', async () => {
    await expect(
      runLegalScan({ workspaceRoot: '/missing', input: { paths: ['../escape'] } }),
    ).rejects.toThrow()
    const stop = new AbortController()
    stop.abort()
    await expect(runLegalScan({ workspaceRoot, input: {}, signal: stop.signal })).rejects.toThrow()
  })

  it('honours a stop queued before the report is returned', async () => {
    const stop = new AbortController()
    const pending = runLegalScan({ workspaceRoot, input: {}, signal: stop.signal })
    stop.abort()
    await expect(pending).rejects.toThrow()
  })

  it('lists only resolved missing-license registry targets without making a request', async () => {
    const handle = await runLegalScan({
      workspaceRoot: path.resolve('test/fixtures/legal/registry'),
      input: {},
    })
    expect(handle.result.findings.length).toBeGreaterThan(0)
    expect(handle.registryTargets).toEqual(
      expect.arrayContaining([{ ecosystem: 'npm', name: 'missing-license', version: '1.0.0' }]),
    )
    const text = await runLegalCommand({
      options: { format: 'text', out: undefined, registry: false },
      deps: {
        scan: () => Promise.resolve(handle),
        fetch: () => {
          throw new Error('offline scan must not fetch')
        },
        writeFile: () => {
          throw new Error('unrequested export')
        },
      },
    })
    expect(text.out).toContain(UI_TEXT.legalScanDisclaimer)
    expect(text.out).toContain('Confidence: 100%')
  })
})
