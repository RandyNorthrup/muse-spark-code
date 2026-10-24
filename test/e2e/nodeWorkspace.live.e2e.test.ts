// M110b W2 live drills (MUSE_NODE_DRILL=1): workspace git and snapshots
// against real git and tar in scratch dirs — clone, snapshot, restore
// with ignored files kept, repository filters off, pushes/merges/
// submodules refused; then the devcontainer path against the real
// pinned CLI and daemon — version, read, gate, merge, up, exec, and
// the image digest read back for recording. SSH remotes stay
// unit-tested here: their live proof needs an agent, keys and sshd,
// which is joint work with M109's owner (the broker provisions the
// socket; this layer only spends it).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  connectEngine,
  inspectImage,
  inspectSandbox,
  removeSandbox,
  stopSandbox,
} from '../../src/runtime/node/sandbox/engine'
import {
  checkDevcontainerVersion,
  devcontainerExec,
  devcontainerUp,
  gateDevcontainerConfig,
  mergeDevcontainerConfig,
  readDevcontainerConfig,
} from '../../src/runtime/node/workspaces/devcontainer'
import { DEVCONTAINER_CLI_PIN } from '../../src/shared/constants'
import {
  GitRefusedError,
  runWorkspaceGit,
  type BrokerGitProvisions,
} from '../../src/runtime/node/workspaces/git'
import {
  createWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  type SnapshotTools,
} from '../../src/runtime/node/workspaces/snapshots'
import { useRuntimeGovernor } from '../unit/helpers/resources/runtimeGovernor'

const IS_DRILL = process.env['MUSE_NODE_DRILL'] === '1'
// git, tar and the devcontainer CLI start through the governed launch:
// admitted by the governor the node command's process configures.
useRuntimeGovernor('muse-ws-drill-jobs-', IS_DRILL)
const NO_PROVISIONS: BrokerGitProvisions = {}
const GRANTS: [] = []
const DRILL_IMAGE = 'debian:trixie-slim'
const DRILL_STOP_SECONDS = 10

function tools(remote: string): SnapshotTools {
  return {
    gitPath: 'git',
    tarPath: 'tar',
    platform: process.platform,
    baseEnv: process.env,
    remote,
  }
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync('git', argv, { cwd, encoding: 'utf8' })
}

function seedOrigin(dir: string): void {
  git(dir, 'init', '-q', '.')
  git(dir, 'config', 'user.email', 'drill@example.test')
  git(dir, 'config', 'user.name', 'drill')
  writeFileSync(path.join(dir, 'tracked.txt'), 'v1\n')
  writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n')
  git(dir, 'add', 'tracked.txt', '.gitignore')
  git(dir, 'commit', '-qm', 'seed')
}

describe.skipIf(!IS_DRILL)('workspace git and snapshots, live', () => {
  it(
    'clones, snapshots, and restores with ignored files kept',
    // Real git and tar on scratch repos; the clock covers process
    // spawn, not the assertions.
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'muse-ws-drill-'))
      const origin = path.join(root, 'origin')
      const workspace = path.join(root, 'workspace')
      mkdirSync(origin, { recursive: true })
      seedOrigin(origin)
      const cloned = await runWorkspaceGit('git', ['clone', origin, workspace], {
        cwd: root,
        platform: process.platform,
        baseEnv: process.env,
        remote: origin,
        provisions: NO_PROVISIONS,
        grants: GRANTS,
      })
      expect(cloned.exitCode).toBe(0)
      expect(readFileSync(path.join(workspace, 'tracked.txt'), 'utf8')).toBe('v1\n')
      writeFileSync(path.join(workspace, 'tracked.txt'), 'v2-dirty\n')
      writeFileSync(path.join(workspace, 'new-untracked.txt'), 'untracked\n')
      writeFileSync(path.join(workspace, 'ignored.txt'), 'precious\n')
      const snapDir = path.join(root, 'snap-1')
      mkdirSync(snapDir, { recursive: true })
      const manifest = await createWorkspaceSnapshot(
        tools(origin),
        workspace,
        snapDir,
        '2026-10-22T00:00:00.000Z',
      )
      expect(manifest.method).toBe('bundle')
      expect(manifest.archive).toBe('untracked.tar.gz')
      git(workspace, 'commit', '-qam', 'advance')
      writeFileSync(path.join(workspace, 'tracked.txt'), 'v3-dirty\n')
      writeFileSync(path.join(workspace, 'new-untracked.txt'), 'changed\n')
      const preDir = path.join(root, 'snap-pre')
      mkdirSync(preDir, { recursive: true })
      const restored = await restoreWorkspaceSnapshot(
        tools(origin),
        workspace,
        snapDir,
        preDir,
        '2026-10-22T00:01:00.000Z',
      )
      expect(restored.head).toBe(manifest.head)
      expect(readFileSync(path.join(workspace, 'tracked.txt'), 'utf8')).toBe('v2-dirty\n')
      expect(readFileSync(path.join(workspace, 'new-untracked.txt'), 'utf8')).toBe('untracked\n')
      expect(readFileSync(path.join(workspace, 'ignored.txt'), 'utf8')).toBe('precious\n')
      const preManifest = JSON.parse(readFileSync(path.join(preDir, 'manifest.json'), 'utf8')) as {
        head: string
      }
      expect(preManifest.head).not.toBe(manifest.head)
    },
  )
  it(
    'runs repository filters off: named but undefined, the file lands raw',
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'muse-ws-filter-'))
      const origin = path.join(root, 'origin')
      mkdirSync(origin, { recursive: true })
      git(origin, 'init', '-q', '.')
      git(origin, 'config', 'user.email', 'drill@example.test')
      git(origin, 'config', 'user.name', 'drill')
      writeFileSync(path.join(origin, '.gitattributes'), '*.dat filter=rot\n')
      writeFileSync(path.join(origin, 'secret.dat'), 'abcdef\n')
      git(origin, 'add', '.gitattributes', 'secret.dat')
      git(origin, 'commit', '-qm', 'seed')
      const workspace = path.join(root, 'workspace')
      await runWorkspaceGit('git', ['clone', origin, workspace], {
        cwd: root,
        platform: process.platform,
        baseEnv: process.env,
        remote: origin,
        provisions: NO_PROVISIONS,
        grants: GRANTS,
      })
      rmSync(path.join(workspace, 'secret.dat'))
      const checked = await runWorkspaceGit('git', ['checkout', '-q', '--', 'secret.dat'], {
        cwd: workspace,
        platform: process.platform,
        baseEnv: process.env,
        remote: origin,
        provisions: NO_PROVISIONS,
        grants: GRANTS,
      })
      expect(checked.exitCode).toBe(0)
      expect(readFileSync(path.join(workspace, 'secret.dat'), 'utf8')).toBe('abcdef\n')
      git(workspace, 'config', 'filter.rot.smudge', 'tr a-z n-za-m')
      rmSync(path.join(workspace, 'secret.dat'))
      execFileSync('git', ['checkout', '--', 'secret.dat'], { cwd: workspace })
      expect(readFileSync(path.join(workspace, 'secret.dat'), 'utf8')).toBe('nopqrs\n')
    },
  )
  it('refuses push, merge, submodule, config and runners without running git', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-ws-refuse-'))
    const attempt = async (argv: string[]): Promise<string> => {
      try {
        await runWorkspaceGit('git', argv, {
          cwd: root,
          platform: process.platform,
          baseEnv: process.env,
          remote: root,
          provisions: NO_PROVISIONS,
          grants: GRANTS,
        })
      } catch (error: unknown) {
        if (error instanceof GitRefusedError) return error.reason
        throw error
      }
      throw new Error(`ran refused argv: ${argv.join(' ')}`)
    }
    expect(await attempt(['push', 'origin', 'main'])).toBe('push-ungranted')
    expect(await attempt(['merge', 'main'])).toBe('merge-family')
    expect(await attempt(['clone', '--recurse-submodules', root])).toBe('submodule')
    expect(await attempt(['fetch', root, '-c', 'a=b'])).toBe('unsafe-flag')
    expect(await attempt(['status', '-C', root])).toBe('unsafe-flag')
    expect(await attempt(['clean', '-fdx'])).toBe('unsafe-flag')
  })
})

describe.skipIf(!IS_DRILL)('devcontainer up and exec, live', () => {
  let cliPath = ''
  // Installs the pinned CLI from the registry into scratch (a node
  // prereq, not a repo dependency); the clock covers the download.
  beforeAll(() => {
    const prefix = mkdtempSync(path.join(tmpdir(), 'muse-dc-cli-'))
    execFileSync(
      'npm',
      [
        'install',
        '--prefix',
        prefix,
        `@devcontainers/cli@${DEVCONTAINER_CLI_PIN}`,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
      ],
      { encoding: 'utf8' },
    )
    cliPath = path.join(
      prefix,
      'node_modules',
      '.bin',
      `devcontainer${process.platform === 'win32' ? '.cmd' : ''}`,
    )
  }, 180_000)
  it(
    'brings the box up from the merged override and reads its digest back',
    // Container create, start, exec and inspect against the real
    // daemon; the clock covers the daemon, not the assertions.
    { timeout: 120_000 },
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'muse-dc-drill-'))
      const workspace = path.join(root, 'ws')
      mkdirSync(path.join(workspace, '.devcontainer'), { recursive: true })
      writeFileSync(
        path.join(workspace, '.devcontainer', 'devcontainer.json'),
        JSON.stringify({ image: DRILL_IMAGE }),
      )
      await checkDevcontainerVersion(cliPath, workspace)
      const resolved = await readDevcontainerConfig(cliPath, workspace)
      expect(resolved.configuration.image).toBe(DRILL_IMAGE)
      expect(gateDevcontainerConfig(resolved, workspace, true, process.platform)).toEqual({
        ok: true,
      })
      const merged = mergeDevcontainerConfig(
        resolved,
        workspace,
        { proxyUrl: 'http://127.0.0.1:9' },
        process.platform,
      )
      expect(merged['image']).toBe(DRILL_IMAGE)
      const overrideConfig = path.join(root, 'override.json')
      writeFileSync(overrideConfig, JSON.stringify(merged))
      const up = await devcontainerUp(cliPath, {
        workspaceDir: workspace,
        overrideConfig,
        idLabels: { 'muse.drill': 'devcontainer' },
      })
      expect(up.outcome).toBe('success')
      if (up.outcome !== 'success') throw new Error(`up failed: ${up.message}`)
      const engine = await connectEngine()
      try {
        const ran = await devcontainerExec(cliPath, workspace, {
          containerId: up.containerId,
          command: ['sh', '-c', 'echo drill-marker'],
        })
        expect(ran.exitCode).toBe(0)
        expect(ran.stdout).toContain('drill-marker')
        const inspected = await inspectSandbox(engine, up.containerId)
        const image = await inspectImage(engine, inspected.parsed.Image)
        expect(image.id).toMatch(/^sha256:[0-9a-f]{64}$/)
        for (const digest of image.digests) {
          expect(digest).toMatch(/^.+@sha256:[0-9a-f]{64}$/)
        }
      } finally {
        await stopSandbox(engine, up.containerId, DRILL_STOP_SECONDS)
        await removeSandbox(engine, up.containerId, true)
      }
    },
  )
})
