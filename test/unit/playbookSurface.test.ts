import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { runPlaybookCli, runPlaybookCommand } from '../../src/runtime/playbook/command'
import { createPlaybookSurface } from '../../src/runtime/playbook/surface'

function surface() {
  const directory = mkdtempSync(path.join(tmpdir(), 'm116w-surface-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const workspaceFolder = path.join(directory, 'workspace')
  mkdirSync(workspaceFolder, { recursive: true })
  return createPlaybookSurface({
    agentDataFolder: path.join(directory, 'data'),
    workspaceFolder,
    teamId: 'panel',
    laneId: 'surface',
  })
}

describe('M116 playbook surface adapter (W)', () => {
  it('reads defaults and persists user-initiated changes durably', async () => {
    const port = surface()
    const first = await port.read()
    const snapshot = first as { settings: { teamId: string }; records: readonly unknown[] }
    expect(snapshot.settings.teamId).toBe('panel')
    expect(snapshot.records).toEqual([])
    const changed = (await port.change({
      rule: 'offload',
      enabled: false,
      reason: 'Owner decision.',
    })) as { settings: { rules: { offload: { enabled: boolean; actor: string } } } }
    expect(changed.settings.rules.offload.enabled).toBe(false)
    // The adapter stamps the trusted actor, never a request body.
    expect(changed.settings.rules.offload.actor).toBe('owner')
    const reread = (await port.read()) as typeof changed
    expect(reread.settings.rules.offload.enabled).toBe(false)
  })

  it('sets and clears the fallback reviewer through the authority path', async () => {
    const port = surface()
    const set = await runPlaybookCommand(
      { view: 'settings', change: { fallbackReviewer: 'r1', reason: 'Owner names.' } },
      port,
    )
    expect(set.ok).toBe(true)
    expect(set.text).toContain('r1')
    const cleared = await runPlaybookCommand(
      { view: 'settings', change: { fallbackReviewer: 'off' } },
      port,
    )
    expect(cleared.ok).toBe(true)
    expect(cleared.text).toContain('No fallback reviewer named')
  })

  it('routes the CLI playbook command and reports usage for bad syntax', async () => {
    expect(parseCommandLine(['playbook', 'status'])).toEqual({
      command: 'playbook',
      argv: ['status'],
    })
    const port = surface()
    const lines: string[] = []
    const errors: string[] = []
    expect(
      await runPlaybookCli(['status'], {
        port,
        writeStdout: (text) => {
          lines.push(text)
        },
        printError: (line) => {
          errors.push(line)
        },
      }),
    ).toBe(0)
    expect(lines.join('\n')).toContain('Playbook settings')
    expect(
      await runPlaybookCli(['frobnicate'], {
        port,
        writeStdout: (text) => {
          lines.push(text)
        },
        printError: (line) => {
          errors.push(line)
        },
      }),
    ).toBe(2)
    expect(errors.join('\n')).toContain('playbook')
  })

  it('rejects invalid changes without persisting them', async () => {
    const port = surface()
    // Hostile wire value: no typed test can spell a rule outside
    // PLAYBOOK_CONFIGURABLE_RULES, so the cast feeds one in; the surface
    // re-parses every change through the zod schema before persisting.
    await expect(
      port.change({ rule: 'neverAround', enabled: false, reason: 'No.' } as never),
    ).rejects.toThrow()
    const reread = (await port.read()) as {
      settings: { rules: Record<string, { enabled: boolean }> }
    }
    expect(reread.settings.rules['offload']?.enabled).toBe(true)
    expect(reread.settings.rules['neverAround']).toBe(undefined)
  })
})
