import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const ports = [
  'acp/agent.ts',
  'acp/schedules.ts',
  'core/estimator/recommend.ts',
  'core/paid/paidConsent.ts',
  'core/reporting/sources/types.ts',
  'core/schedules/agentTools.ts',
  'core/voice/transcribeBatch.ts',
  'runtime/cliArgs.ts',
  'runtime/schedules/args.ts',
  'runtime/schedules/control.ts',
  'runtime/schedules/registration.ts',
  'shared/accounts.ts',
  'webview/schedules/ports.ts',
  'core/backends/modelapi/client.ts',
  'core/backends/modelapi/sessionBudget.ts',
  'core/backends/modelapi/hookHandlers.ts',
  'core/judge/admission.ts',
  'core/tab/tabSpend.ts',
  'host/paid/paidDailyBudget.ts',
  'host/paid/paidHost.ts',
  'host/tab/tabLedger.ts',
  'shared/paid.ts',
  'runtime/exec/execArgs.ts',
  'runtime/exec/execProtocol.ts',
  'runtime/exec/runLedger.ts',
]

describe('R3 P3 exact money ports', () => {
  it.each(ports)('%s has no numeric or legacy-union current money port', async (file) => {
    const source = await readFile(
      new URL(`../../src/${file.replaceAll('\\', '/')}`, import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(/\bLegacyUsd\b/)
    if (file === 'host/paid/paidDailyBudget.ts') expect(source).not.toMatch(/\bNumber\(value\)/)
    expect(source).not.toMatch(/\b\w*Usd\??\s*:\s*(?:\([^)]*\)\s*=>\s*)?number\b/)
    expect(source).not.toMatch(
      /\b(?:remainingUsd|outstandingUsd)\([^)]*\)\s*:\s*(?:Promise<)?number\b/,
    )
    expect(source).not.toMatch(/\bNumber\((?:entered|[^)]*Usd)\)/)
  })
})

it('R3 P3: no current USD money port anywhere in src accepts a JavaScript number', async () => {
  const root = new URL('../../src/', import.meta.url)
  const names = await readdir(root, { recursive: true })
  const violations: string[] = []
  const pattern = /\b\w*Usd\??\s*:\s*(?:\([^)]*\)\s*=>\s*)?number\b/
  for (const name of names) {
    const normalized = name.replaceAll('\\', '/')
    if (!/\.tsx?$/.test(normalized)) continue
    const source = await readFile(new URL(normalized, root), 'utf8')
    for (const [index, line] of source.split('\n').entries())
      if (pattern.test(line)) violations.push(`${normalized}:${String(index + 1)} ${line.trim()}`)
  }
  expect(violations).toEqual([])
})
