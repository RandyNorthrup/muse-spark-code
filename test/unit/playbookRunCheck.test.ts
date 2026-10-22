// M116 (D213): headless `playbook run <name>` through the real policy,
// journal and spawn. Unknown capacity admits (the owner rule); a paused
// reading refuses with its why-note and never spawns. Shell lines are
// the shells' own (`exit`, `sleep`), quiet on both interpreters.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import {
  FilePlaybookJournal,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import { parsePlaybookCommand } from '../../src/runtime/playbook/command'
import { resourceStatusSchema } from '../../src/shared/resources'
import { runPlaybookCheckCli, type PlaybookCheckCliDeps } from '../../src/runtime/playbook/runCheck'
import { spawnCheckLine } from '../../src/runtime/playbook/spawnCheck'

/** A scratch workspace/data pair, removed when the test finishes. */
function scratchFolders(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const workspaceFolder = path.join(directory, 'workspace')
  mkdirSync(workspaceFolder, { recursive: true })
  return { workspaceFolder, agentDataFolder: path.join(directory, 'data') }
}

function deps(
  folders: { workspaceFolder: string; agentDataFolder: string },
  settings: string | undefined,
  overrides?: Partial<PlaybookCheckCliDeps> & { spawned?: { count: number } },
): { deps: PlaybookCheckCliDeps; lines: string[]; errors: string[]; logs: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  const logs: string[] = []
  const { spawned, ...rest } = overrides ?? {}
  return {
    deps: {
      agentDataFolder: folders.agentDataFolder,
      workspaceFolder: folders.workspaceFolder,
      teamId: 'panel',
      laneId: 'surface',
      platform: process.platform,
      readSettingsFile: () => settings,
      readResourceStatus: () => Promise.resolve(undefined),
      spawn: {
        run: (line, timeoutMs) => {
          if (spawned !== undefined) spawned.count += 1
          return spawnCheckLine(line, timeoutMs, {
            platform: process.platform,
            systemRoot: process.env['SystemRoot'],
            workspaceRoot: folders.workspaceFolder,
            env: process.env,
            fileExists: existsSync,
            realpath: realpathSync,
            log: () => undefined,
          })
        },
      },
      writeStdout: (text) => {
        lines.push(text)
      },
      printError: (line) => {
        errors.push(line)
      },
      log: (message) => {
        logs.push(message)
      },
      ...rest,
    },
    lines,
    errors,
    logs,
  }
}

/** The journal's records after the run, through a fresh handle. */
function journalOf(folders: { workspaceFolder: string; agentDataFolder: string }) {
  return validatedRecords(
    new FilePlaybookJournal(folders.agentDataFolder, folders.workspaceFolder).read(),
  )
}

const SETTINGS = JSON.stringify({
  'museSpark.checkCommands': [
    { name: 'quiet', command: 'exit 0' },
    { name: 'loud', command: 'exit 3' },
  ],
})

describe('playbook run', () => {
  it('runs the named check, journals the allow note and exits with its code', async () => {
    const folders = scratchFolders('m116w-run-pass-')
    const spawned = { count: 0 }
    const { deps: run, lines, errors } = deps(folders, SETTINGS, { spawned })
    await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(0)
    expect(spawned.count).toBe(1)
    expect(errors).toEqual([])
    expect(lines[0]).toBe('quiet passed')
    expect(lines).toHaveLength(2)
    const records = journalOf(folders)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'note',
      value: { rule: 'offload', code: 'localCheck' },
    })
    expect(lines[1]).toContain(
      'Playbook: no worker is offered; run locally under the resource governor.',
    )
  })

  it('passes a failing check’s exit code through', async () => {
    const folders = scratchFolders('m116w-run-fail-')
    const { deps: run, lines } = deps(folders, SETTINGS)
    await expect(runPlaybookCheckCli(['loud'], run)).resolves.toBe(3)
    expect(lines[0]).toBe('loud failed')
    expect(journalOf(folders)).toHaveLength(1)
  })

  it('accepts the offload flags and still runs locally headless', async () => {
    const folders = scratchFolders('m116w-run-flags-')
    const { deps: run, lines } = deps(folders, SETTINGS)
    await expect(runPlaybookCheckCli(['quiet', '--heavy', '--full-gate'], run)).resolves.toBe(0)
    expect(lines[0]).toBe('quiet passed')
    const records = journalOf(folders)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'note',
      value: { rule: 'offload', code: 'localCheck' },
    })
  })

  it('refuses at the paused level without spawning, with the why-note', async () => {
    const folders = scratchFolders('m116w-run-refuse-')
    const spawned = { count: 0 }
    const paused = resourceStatusSchema.parse({
      level: 'pause',
      sample: null,
      settings: {},
      queued: [],
      overrideUntilMs: null,
    })
    const {
      deps: run,
      lines,
      errors,
    } = deps(folders, SETTINGS, {
      spawned,
      readResourceStatus: () => Promise.resolve(paused),
    })
    await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(1)
    expect(spawned.count).toBe(0)
    expect(errors).toEqual([])
    expect(lines[0]).toBe('quiet not run')
    const records = journalOf(folders)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'note',
      value: { rule: 'offload', code: 'prerequisiteMissing', missing: ['resourceGovernor'] },
    })
    expect(lines[1]).toContain('Playbook: lane quiet waits for resourceGovernor.')
  })

  it('times the check out on its own cap and journals the allow', async () => {
    const folders = scratchFolders('m116w-run-timeout-')
    const settings = JSON.stringify({
      'museSpark.checkCommands': [{ name: 'slow', command: 'sleep 30', timeoutSeconds: 1 }],
    })
    const { deps: run, lines } = deps(folders, settings)
    await expect(runPlaybookCheckCli(['slow'], run)).resolves.toBe(1)
    expect(lines[0]).toBe('slow timed out')
    const records = journalOf(folders)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'note',
      value: { rule: 'offload', code: 'localCheck' },
    })
  })

  it('reads a commented settings file like the panel does', async () => {
    const folders = scratchFolders('m116w-run-jsonc-')
    const settings = `{
      // The workspace's checks.
      "museSpark.checkCommands": [
        { "name": "quiet", "command": "exit 0", },
      ],
    }`
    const { deps: run, lines } = deps(folders, settings)
    await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(0)
    expect(lines[0]).toBe('quiet passed')
  })

  it('reads the nested settings object behind the flat key', async () => {
    const folders = scratchFolders('m116w-run-nested-')
    const settings = JSON.stringify({
      museSpark: { checkCommands: [{ name: 'quiet', command: 'exit 0' }] },
    })
    const { deps: run, lines } = deps(folders, settings)
    await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(0)
    expect(lines[0]).toBe('quiet passed')
  })

  it('names the unknown check and the known ones, and journals nothing', async () => {
    const folders = scratchFolders('m116w-run-unknown-')
    const spawned = { count: 0 }
    const { deps: run, errors } = deps(folders, SETTINGS, { spawned })
    await expect(runPlaybookCheckCli(['nope'], run)).resolves.toBe(2)
    expect(spawned.count).toBe(0)
    expect(errors).toEqual(['Unknown check nope (known checks: quiet, loud).'])
    expect(journalOf(folders)).toEqual([])
  })

  it('says no checks are configured for a missing file or an empty list', async () => {
    for (const settings of [
      undefined,
      JSON.stringify({}),
      JSON.stringify({ 'museSpark.checkCommands': [] }),
    ]) {
      const folders = scratchFolders('m116w-run-nochecks-')
      const { deps: run, errors } = deps(folders, settings)
      await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(2)
      expect(errors).toEqual([
        'No check commands are configured; name them in the museSpark.checkCommands setting.',
      ])
    }
  })

  it('tells a broken file from a broken setting', async () => {
    const brokenFile = scratchFolders('m116w-run-badfile-')
    const { deps: runFile, errors: fileErrors } = deps(brokenFile, '{oops')
    await expect(runPlaybookCheckCli(['quiet'], runFile)).resolves.toBe(2)
    expect(fileErrors).toEqual(['The workspace .vscode/settings.json is not valid.'])
    const brokenSetting = scratchFolders('m116w-run-badsetting-')
    const { deps: runSetting, errors: settingErrors } = deps(
      brokenSetting,
      JSON.stringify({ 'museSpark.checkCommands': [{ name: 'quiet' }] }),
    )
    await expect(runPlaybookCheckCli(['quiet'], runSetting)).resolves.toBe(2)
    expect(settingErrors).toEqual([
      'The museSpark.checkCommands setting is invalid, so no check commands are available.',
    ])
  })

  it('prints usage for a missing name, a flag-like name or a bad flag', async () => {
    for (const argv of [[], ['--heavy'], ['quiet', '--bogus'], ['quiet', 'extra']]) {
      const folders = scratchFolders('m116w-run-usage-')
      const { deps: run, errors } = deps(folders, SETTINGS)
      await expect(runPlaybookCheckCli(argv, run)).resolves.toBe(2)
      expect(errors).toEqual([
        'Use `playbook status|record|settings|run <name> [--heavy] [--full-gate]`.',
      ])
    }
  })

  it('says the command failed when no interpreter exists, without spawning', async () => {
    const folders = scratchFolders('m116w-run-nointerp-')
    const logs: string[] = []
    const { deps: run, errors } = deps(folders, SETTINGS, {
      spawn: {
        run: (line, timeoutMs) =>
          spawnCheckLine(line, timeoutMs, {
            platform: process.platform,
            systemRoot: process.env['SystemRoot'],
            workspaceRoot: folders.workspaceFolder,
            env: process.env,
            fileExists: () => false,
            realpath: realpathSync,
            log: (message) => {
              logs.push(message)
            },
          }),
      },
    })
    await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(1)
    expect(errors).toEqual(['The playbook command could not be completed.'])
    expect(logs).toEqual(['no shell interpreter outside the workspace'])
    // The admission was journaled before the spawn failed.
    expect(journalOf(folders)).toHaveLength(1)
  })

  it('stays out of the shared read-only grammar, so ACP keeps its surface', () => {
    expect(parsePlaybookCommand(['run', 'quiet'])).toBeUndefined()
    expect(parsePlaybookCommand(['run'])).toBeUndefined()
  })

  it('says the command failed when the settings cannot be read', async () => {
    const folders = scratchFolders('m116w-run-unreadable-')
    const {
      deps: run,
      errors,
      logs,
    } = deps(folders, SETTINGS, {
      readSettingsFile: () => {
        throw new Error('EACCES')
      },
    })
    await expect(runPlaybookCheckCli(['quiet'], run)).resolves.toBe(1)
    expect(errors).toEqual(['The playbook command could not be completed.'])
    expect(logs).toEqual(['playbook run failed: Error'])
  })
})
