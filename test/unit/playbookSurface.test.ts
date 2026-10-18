import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { acpPlaybook, type AcpPlaybookBundle } from '../../src/acp/playbook'
import { requireFile } from '../../src/host/lazyBundle'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  parsePlaybookCommand,
  runPlaybookCli,
  runPlaybookCommand,
  type PlaybookCommand,
  type PlaybookSurfacePort,
} from '../../src/runtime/playbook/command'
import { createPlaybookSurface } from '../../src/runtime/playbook/surface'
import { UI_TEXT } from '../../src/shared/constants'

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
    expect(lines.join('\n')).toContain('Playbook Settings')
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

  it('a loaded playbook whose command fails says so, never unavailable', async () => {
    const port = surface()
    // The safety rule is not configurable: the loaded playbook's command
    // rejects the change, and the failure names the command, not the
    // playbook's availability.
    const failed = await runPlaybookCommand(
      {
        view: 'settings',
        change: { rule: 'neverAround', enabled: false, reason: 'No.' } as never,
      },
      port,
    )
    expect(failed.ok).toBe(false)
    expect(failed.text).toBe(UI_TEXT.playbookCommandFailed)
    expect(failed.text).not.toBe(UI_TEXT.playbookUnavailable)
  })

  it('a missing surface stays unavailable', async () => {
    expect(await runPlaybookCommand({ view: 'status' }, undefined)).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
  })

  it('the ACP command carries the loaded playbook answer through', async () => {
    const port = surface()
    const bundle = {
      parsePlaybookCommand,
      runPlaybookCommand: (
        command: PlaybookCommand,
        surfacePort: PlaybookSurfacePort | undefined,
      ) => runPlaybookCommand(command, surfacePort),
    }
    const load = () => bundle
    const status = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => port,
      load,
    )
    expect(status?.ok).toBe(true)
    // No surface bound: the loaded playbook answers unavailable, and the ACP
    // layer carries that answer instead of replacing it.
    const noSurface = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => undefined,
      load,
    )
    expect(noSurface).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
  })

  it('a bundle that cannot load stays unavailable', async () => {
    // The real Node loader on a missing file: the bundle genuinely fails to
    // load, so the person reads unavailable.
    const missing = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => undefined,
      () => requireFile('/nonexistent/acpPlaybook.js') as AcpPlaybookBundle,
    )
    expect(missing).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
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
