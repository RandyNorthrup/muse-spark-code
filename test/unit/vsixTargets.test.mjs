import { describe, expect, it } from 'vitest'
import {
  VSIX_TARGETS,
  requiredNativeFiles,
  targetFromArgs,
  targetOfVsix,
  vsixArtifactName,
  vsixReleaseAssets,
  isVsixTargetFile,
} from '../../scripts/lib/vsixTargets.mjs'

// One .vsix per platform: each target's package keeps only its own
// platform's native pieces. A wrong row here ships a person a package
// missing the helper their platform runs, or an oversize package carrying
// every other platform's.
const WINDOWS_FILES = [
  'native/windows/dictate.ps1',
  'native/windows/capture.ps1',
  'native/windows/MuseSparkJob.cs',
  'native/windows/MuseSparkMcpJob.cs',
  'native/windows/MuseSparkMcpLauncher.cs',
  'native/windows/MuseSparkScreenRecord.cs',
  'native/windows/MuseSparkVault.cs',
  'native/windows/MuseSparkVaultCng.cs',
  'native/windows/MuseSparkVaultHello.cs',
  'native/windows/MuseSparkVaultLock.cs',
  'native/windows/MuseSparkVaultPipe.cs',
]
const DARWIN_FILES = [
  'native/darwin/muse-dictate',
  'native/darwin/muse-dictate-screen.app/Contents/MacOS/muse-dictate',
  'native/darwin/muse-vault-peer',
  'dist/native/darwin/muse-vault',
]
const LINUX_FILES = [
  'native/linux/x64/muse-created',
  'native/linux/x64/muse-vault-peer',
  'native/linux/arm64/muse-created',
  'native/linux/arm64/muse-vault-peer',
]
const SHARED_FILES = [
  'dist/extension.js',
  'dist/vault.js',
  'dist/vaultBroker.js',
  'dist/vaultRuntime.js',
  'dist/vaultWindows.js',
  'native/runner/runner-helper.ps1',
  'native/runner/runner-helper.sh',
  'package.json',
]

describe('per-platform VSIX inventory', () => {
  it('ships the six supported desktop targets', () => {
    expect(VSIX_TARGETS).toEqual([
      'win32-x64',
      'win32-arm64',
      'darwin-x64',
      'darwin-arm64',
      'linux-x64',
      'linux-arm64',
    ])
  })

  it('keeps each platform’s helpers on its own targets only', () => {
    for (const target of VSIX_TARGETS) {
      const [platform] = target.split('-', 1)
      for (const file of WINDOWS_FILES)
        expect(isVsixTargetFile(target, file)).toBe(platform === 'win32')
      for (const file of DARWIN_FILES)
        expect(isVsixTargetFile(target, file)).toBe(platform === 'darwin')
      for (const file of LINUX_FILES) {
        const arch = file.split('/', 3)[2]
        expect(isVsixTargetFile(target, file)).toBe(target === `linux-${arch}`)
      }
      for (const file of SHARED_FILES) expect(isVsixTargetFile(target, file)).toBe(true)
    }
  })

  it('matches Windows separators like CI does', () => {
    expect(isVsixTargetFile('win32-x64', String.raw`native\windows\MuseSparkVaultPipe.cs`)).toBe(
      true,
    )
    expect(isVsixTargetFile('linux-x64', String.raw`native\windows\MuseSparkVaultPipe.cs`)).toBe(
      false,
    )
    expect(isVsixTargetFile('darwin-arm64', String.raw`dist\native\darwin\muse-vault`)).toBe(true)
  })

  it('refuses an unknown target instead of packing the wrong package', () => {
    expect(() => isVsixTargetFile('linux-riscv64', 'dist/extension.js')).toThrow()
    expect(() => requiredNativeFiles('web')).toThrow()
    expect(() => vsixArtifactName('agent', '0.1.0', 'win32')).toThrow()
  })

  it('reads the target from packager arguments', () => {
    expect(targetFromArgs(['node', 'package-vsix.mjs'])).toBeUndefined()
    expect(targetFromArgs(['node', 'package-vsix.mjs', '--target', 'linux-arm64'])).toBe(
      'linux-arm64',
    )
    expect(() => targetFromArgs(['node', 'package-vsix.mjs', '--target'])).toThrow()
    expect(() => targetFromArgs(['node', 'package-vsix.mjs', '--target', 'haiku'])).toThrow()
  })

  it('names targeted artifacts the way vsce does', () => {
    expect(vsixArtifactName('muse-spark-code', '0.19.0', 'win32-x64')).toBe(
      'muse-spark-code-win32-x64-0.19.0.vsix',
    )
    expect(targetOfVsix('out/muse-spark-code-win32-x64-0.19.0.vsix')).toBe('win32-x64')
    expect(targetOfVsix('out/muse-spark-code-0.19.0.vsix')).toBeUndefined()
  })

  it('publishes one artifact per target and no universal package', () => {
    const assets = vsixReleaseAssets('muse-spark-code', '0.19.0')
    expect(assets).toHaveLength(VSIX_TARGETS.length)
    for (const target of VSIX_TARGETS) {
      const asset = `muse-spark-code-${target}-0.19.0.vsix`
      expect(assets).toContain(asset)
      expect(targetOfVsix(`release/${asset}`)).toBe(target)
    }
    expect(assets).not.toContain('muse-spark-code-0.19.0.vsix')
  })

  it('requires each stage to hold its own git-kept helpers', () => {
    expect(requiredNativeFiles()).toEqual([
      'native/linux/x64/muse-created',
      'native/linux/arm64/muse-created',
    ])
    expect(requiredNativeFiles('linux-arm64')).toEqual(['native/linux/arm64/muse-created'])
    expect(requiredNativeFiles('win32-x64')).toContain('native/windows/MuseSparkVaultPipe.cs')
    for (const file of [
      'native/windows/MuseSparkVault.cs',
      'native/windows/MuseSparkVaultCng.cs',
      'native/windows/MuseSparkVaultHello.cs',
      'native/windows/MuseSparkVaultLock.cs',
    ])
      expect(requiredNativeFiles('win32-x64')).toContain(file)
    expect(requiredNativeFiles('darwin-arm64')).toEqual([])
  })
})
