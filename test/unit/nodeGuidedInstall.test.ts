// M110t TV: per-OS install plans carry the packs' pins — exact on
// winget and the ecosystems, reported-by-check elsewhere — and anything
// no manager carries is blocked, never skipped.
import { describe, expect, it } from 'vitest'
import {
  planGuidedInstall,
  type GuidedManaged,
  type GuidedTool,
} from '../../src/core/toolchains/guidedInstall'

const tool = (name: string, version: string, check: string): GuidedTool => ({
  tool: name,
  version,
  check: [check, '--version'],
})
const managed = (kind: GuidedManaged['kind'], id: string, version: string): GuidedManaged => ({
  kind,
  id,
  version,
  check: [id, '--version'],
})

describe('guided install', () => {
  it('winget carries the exact pin and fails visibly without it', () => {
    const plan = planGuidedInstall('windows', [tool('node', '24.3.0', 'node')], [])
    expect(plan.blocked).toEqual([])
    expect(plan.steps).toEqual([
      {
        kind: 'install',
        argv: ['winget', 'install', '--id', 'OpenJS.NodeJS', '--version', '24.3.0', '--exact'],
      },
      { kind: 'check', argv: ['node', '--version'], want: '24.3.0' },
    ])
  })
  it('versioned brews install side by side and link; majors derive their IDs', () => {
    const plan = planGuidedInstall('macos', [tool('node-24', '24.3.0', 'node')], [])
    expect(plan.steps).toEqual([
      { kind: 'install', argv: ['brew', 'install', 'node@24'] },
      { kind: 'install', argv: ['brew', 'link', 'node@24'] },
      { kind: 'check', argv: ['node', '--version'], want: '24.3.0' },
    ])
    const temurin = planGuidedInstall('windows', [tool('temurin', '25.0.4.1+1', 'java')], [])
    expect(temurin.steps[0]).toEqual({
      kind: 'install',
      argv: [
        'winget',
        'install',
        '--id',
        'EclipseAdoptium.Temurin.25.JDK',
        '--version',
        '25.0.4.1+1',
        '--exact',
      ],
    })
    const macTemurin = planGuidedInstall('macos', [tool('temurin', '25.0.4.1+1', 'java')], [])
    expect(macTemurin.steps[0]).toEqual({
      kind: 'install',
      argv: ['brew', 'install', '--cask', 'temurin@25'],
    })
    const dotnet = planGuidedInstall('windows', [tool('dotnet-sdk', '10.0.402', 'dotnet')], [])
    expect(dotnet.steps[0]).toEqual({
      kind: 'install',
      argv: [
        'winget',
        'install',
        '--id',
        'Microsoft.DotNet.SDK.10',
        '--version',
        '10.0.402',
        '--exact',
      ],
    })
  })
  it('apt updates once, installs bare, and the check reports actual against want', () => {
    const plan = planGuidedInstall(
      'linux',
      [tool('go', '1.27.3', 'go'), tool('shellcheck', '0.10.0', 'shellcheck')],
      [],
    )
    expect(plan.steps).toEqual([
      { kind: 'install', argv: ['sudo', 'apt', 'update'] },
      { kind: 'install', argv: ['sudo', 'apt', 'install', 'golang'] },
      { kind: 'install', argv: ['sudo', 'apt', 'install', 'shellcheck'] },
      { kind: 'check', argv: ['go', '--version'], want: '1.27.3' },
      { kind: 'check', argv: ['shellcheck', '--version'], want: '0.10.0' },
    ])
  })
  it('uv on apt bootstraps from the distro Python, pinned through pip', () => {
    const plan = planGuidedInstall('linux', [tool('uv', '0.13.5', 'uv')], [])
    expect(plan.blocked).toEqual([])
    expect(plan.steps).toEqual([
      { kind: 'install', argv: ['sudo', 'apt', 'update'] },
      { kind: 'install', argv: ['sudo', 'apt', 'install', 'python3', 'python3-pip'] },
      {
        kind: 'install',
        argv: ['python3', '-m', 'pip', 'install', '--user', 'uv==0.13.5'],
      },
      { kind: 'check', argv: ['uv', '--version'], want: '0.13.5' },
    ])
  })
  it('ecosystem installs carry exact pins on every OS', () => {
    const plan = planGuidedInstall(
      'macos',
      [],
      [
        managed('go', 'honnef.co/go/tools/cmd/staticcheck', '2026.2.2'),
        managed('cargo', 'cargo-machete', '0.9.2'),
        managed('npm', 'npm', '11.0.0'),
        managed('uvTools', 'ruff', '0.17.2'),
        managed('uvPythons', 'python', '3.15.1'),
        managed('rust', 'rust', '1.99.1'),
        managed('rust', 'rust-nightly', 'nightly-2026-10-22'),
      ],
    )
    expect(plan.blocked).toEqual([])
    const installs = plan.steps.filter((step) => step.kind === 'install')
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['go', 'install', 'honnef.co/go/tools/cmd/staticcheck@2026.2.2'],
    })
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['cargo', 'install', '--locked', 'cargo-machete', '--version', '0.9.2'],
    })
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['npm', 'install', '--global', 'npm@11.0.0'],
    })
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['uv', 'tool', 'install', 'ruff==0.17.2'],
    })
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['uv', 'python', 'install', '3.15.1'],
    })
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['rustup', 'toolchain', 'install', '1.99.1'],
    })
    expect(installs).toContainEqual({ kind: 'install', argv: ['rustup', 'default', '1.99.1'] })
    expect(installs).toContainEqual({
      kind: 'install',
      argv: ['rustup', 'toolchain', 'install', 'nightly-2026-10-22'],
    })
    expect(installs).not.toContainEqual({
      kind: 'install',
      argv: ['rustup', 'default', 'nightly-2026-10-22'],
    })
  })
  it('PowerShell Gallery rides pwsh with a user scope and no prompts skipped', () => {
    const plan = planGuidedInstall(
      'windows',
      [],
      [managed('psGallery', 'PSScriptAnalyzer', '1.25.0')],
    )
    expect(plan.steps[0]).toEqual({
      kind: 'install',
      argv: [
        'pwsh',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Install-Module -Name PSScriptAnalyzer -RequiredVersion 1.25.0 -Scope CurrentUser',
      ],
    })
  })
  it('whatever no manager carries is blocked, and its check still runs', () => {
    const plan = planGuidedInstall('linux', [tool('rustup', '1.29.2', 'rustup')], [])
    expect(plan.blocked).toEqual([{ tool: 'rustup', version: '1.29.2', code: 'manual-install' }])
    expect(plan.steps).toEqual([{ kind: 'check', argv: ['rustup', '--version'], want: '1.29.2' }])
    const unknownOs = planGuidedInstall(
      'freebsd',
      [tool('go', '1.27.3', 'go')],
      [managed('go', 'x/y', '1.0.0')],
    )
    expect(unknownOs.steps.length).toBe(0)
    expect(unknownOs.blocked).toEqual([
      { tool: 'go', version: '1.27.3', code: 'manual-install' },
      { tool: 'x/y', version: '1.0.0', code: 'manual-install' },
    ])
  })
})
