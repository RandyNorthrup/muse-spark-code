// The MCP era verdicts kept across restarts (PLAN.md D213, cc/mcp2): real
// files in a fresh folder, and the keys of servers planned from settings by
// the product's own reader. The live proof — a second start opening a known
// server without a probe, and a changed server probed again — is
// docs/certification/cc-mcp2.md.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { planMcpServers } from '../../src/core/backends/modelapi/mcp/servers'
import {
  isSameVerdict,
  McpVerdictStore,
  verdictKey,
} from '../../src/core/backends/modelapi/mcp/verdicts'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import { MCP_ERA_VERDICTS_FILE } from '../../src/shared/constants'
import { temporaryTracker } from './helpers/temporaryFolders'

const folders = temporaryTracker()

afterEach(async () => {
  await folders.cleanup()
})

function folder(): Promise<string> {
  return folders.make('mcp-verdicts-')
}

function quiet(): void {
  // The store's other log levels say nothing these tests read.
}

function recording(warnings: string[]): CoreLogger {
  return {
    trace: quiet,
    info: quiet,
    warn: (message) => {
      warnings.push(message)
    },
    error: quiet,
  }
}

/** The identity of each server the product plans from these settings. */
function identities(settings: unknown, env: Readonly<Record<string, string>>): string[] {
  const plan = planMcpServers(readMcpServerEntries(JSON.stringify(settings)), (name) => env[name])
  if (plan.kind !== 'servers') {
    throw new Error(`expected servers, got a ${plan.fault.kind} fault`)
  }
  return plan.specs.map((spec) => spec.identity)
}

const SETTINGS = {
  mcpServers: {
    files: { command: 'node', args: ['server.js', '--token', '${TOKEN}'], cwd: 'tools' },
    web: { type: 'streamable-http', url: 'https://api.example.test/mcp' },
  },
}

describe('verdict keys', () => {
  it('name the launch as written, never the environment’s values', () => {
    const [files, web] = identities(SETTINGS, { TOKEN: 'first-secret' })
    const [filesRotated] = identities(SETTINGS, { TOKEN: 'rotated-secret' })
    expect(files).toBeDefined()
    expect(web).toBeDefined()
    if (files === undefined || web === undefined || filesRotated === undefined) return
    expect(files).not.toContain('secret')
    expect(verdictKey(filesRotated)).toBe(verdictKey(files))
    expect(verdictKey(files)).toMatch(/^[0-9a-f]{64}$/)
    expect(verdictKey(files)).not.toBe(verdictKey(web))
  })

  it('change when the launch changes', () => {
    const [before] = identities(SETTINGS, { TOKEN: 't' })
    const [after] = identities(
      { mcpServers: { files: { ...SETTINGS.mcpServers.files, args: ['other.js'] } } },
      { TOKEN: 't' },
    )
    if (before === undefined || after === undefined) throw new Error('expected two servers')
    expect(verdictKey(after)).not.toBe(verdictKey(before))
  })
})

describe('McpVerdictStore', () => {
  it('keeps each verdict across a restart, storing only the keys', async () => {
    const dir = await folder()
    const warnings: string[] = []
    const [files, web] = identities(SETTINGS, { TOKEN: 'first-secret' })
    if (files === undefined || web === undefined) throw new Error('expected two servers')
    const first = new McpVerdictStore(dir, recording(warnings))
    expect(await first.read(verdictKey(files))).toBeUndefined()
    await Promise.all([
      first.keep(verdictKey(files), { era: 'legacy' }),
      first.keep(verdictKey(web), { era: 'modern', version: '2026-07-28' }),
    ])
    const restarted = new McpVerdictStore(dir, recording(warnings))
    expect(await restarted.read(verdictKey(files))).toEqual({ era: 'legacy' })
    expect(await restarted.read(verdictKey(web))).toEqual({ era: 'modern', version: '2026-07-28' })
    const text = readFileSync(path.join(dir, MCP_ERA_VERDICTS_FILE), 'utf8')
    for (const word of ['files', 'web', 'node', 'server.js', 'example', 'TOKEN', 'secret']) {
      expect(text).not.toContain(word)
    }
    expect(warnings).toEqual([])
  })

  it('rewrites a verdict that changed', async () => {
    const dir = await folder()
    const store = new McpVerdictStore(dir, recording([]))
    await store.keep('k', { era: 'modern', version: '2026-07-28' })
    await store.keep('k', { era: 'legacy' })
    expect(await new McpVerdictStore(dir, recording([])).read('k')).toEqual({ era: 'legacy' })
  })

  it('says a file it cannot read out loud, keeps nothing from it, and replaces it', async () => {
    const dir = await folder()
    writeFileSync(path.join(dir, MCP_ERA_VERDICTS_FILE), '{"format":1,"verdicts":', 'utf8')
    const warnings: string[] = []
    const store = new McpVerdictStore(dir, recording(warnings))
    expect(await store.read('k')).toBeUndefined()
    expect(warnings).toEqual(['The kept MCP era verdicts are not readable; every server is probed'])
    await store.keep('k', { era: 'legacy' })
    expect(await new McpVerdictStore(dir, recording([])).read('k')).toEqual({ era: 'legacy' })
  })

  it('tells a changed verdict from the same one', () => {
    const modern = { era: 'modern', version: '2026-07-28' } as const
    expect(isSameVerdict(modern, { era: 'modern', version: '2026-07-28' })).toBe(true)
    expect(isSameVerdict(modern, { era: 'legacy' })).toBe(false)
    expect(isSameVerdict({ era: 'legacy' }, { era: 'legacy' })).toBe(true)
  })
})
