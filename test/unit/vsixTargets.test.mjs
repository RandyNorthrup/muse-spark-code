import { describe, expect, it } from 'vitest'
import {
  VSIX_TARGETS,
  requiredNativeFiles,
  targetFromArgs,
  targetOfVsix,
  vsixArtifactName,
  isVsixTargetFile,
  vsixFallbackName,
} from '../../scripts/lib/vsixTargets.mjs'

// One .vsix per platform (PLAN.md D123): each target's package keeps only
// its own platform's native pieces. A wrong row here ships a person a
// package missing the helper their platform runs, or an oversize package
// carrying every other platform's.
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
const LINUX_HELPERS = {
  'linux-x64': ['native/linux/x64/muse-created', 'native/linux/x64/muse-vault-peer'],
  'linux-arm64': ['native/linux/arm64/muse-created', 'native/linux/arm64/muse-vault-peer'],
}
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
      for (const [owner, files] of Object.entries(LINUX_HELPERS))
        for (const file of files) expect(isVsixTargetFile(target, file)).toBe(target === owner)
      for (const file of SHARED_FILES) expect(isVsixTargetFile(target, file)).toBe(true)
    }
  })

  it('requires only the target’s own built helpers in the stage', () => {
    expect(requiredNativeFiles()).toEqual([
      'native/linux/x64/muse-created',
      'native/linux/arm64/muse-created',
    ])
    expect(requiredNativeFiles('linux-x64')).toEqual(['native/linux/x64/muse-created'])
    expect(requiredNativeFiles('linux-arm64')).toEqual(['native/linux/arm64/muse-created'])
    expect(requiredNativeFiles('win32-x64')).toEqual([
      'native/windows/dictate.ps1',
      'native/windows/MuseSparkVault.cs',
      'native/windows/MuseSparkVaultCng.cs',
      'native/windows/MuseSparkVaultHello.cs',
      'native/windows/MuseSparkVaultLock.cs',
      'native/windows/MuseSparkVaultPipe.cs',
    ])
    expect(requiredNativeFiles('win32-arm64')).toEqual([
      'native/windows/dictate.ps1',
      'native/windows/MuseSparkVault.cs',
      'native/windows/MuseSparkVaultCng.cs',
      'native/windows/MuseSparkVaultHello.cs',
      'native/windows/MuseSparkVaultLock.cs',
      'native/windows/MuseSparkVaultPipe.cs',
    ])
    // The darwin helpers are git-ignored CI builds, held by the CI content check.
    expect(requiredNativeFiles('darwin-x64')).toEqual([])
    expect(requiredNativeFiles('darwin-arm64')).toEqual([])
  })

  it('compares paths with Windows separators too', () => {
    expect(isVsixTargetFile('win32-x64', String.raw`native\windows\dictate.ps1`)).toBe(true)
    expect(isVsixTargetFile('linux-x64', String.raw`native\windows\dictate.ps1`)).toBe(false)
    expect(isVsixTargetFile('linux-arm64', String.raw`native\linux\arm64\muse-created`)).toBe(true)
    expect(isVsixTargetFile('linux-x64', String.raw`native\linux\arm64\muse-created`)).toBe(false)
  })

  it('names artifacts the way vsce does and reads the target back', () => {
    for (const target of VSIX_TARGETS) {
      const name = vsixArtifactName('muse-spark-code', '0.19.0', target)
      expect(name).toBe(`muse-spark-code-${target}-0.19.0.vsix`)
      expect(targetOfVsix(name)).toBe(target)
    }
    expect(targetOfVsix('muse-spark-code-0.19.0.vsix')).toBeUndefined()
  })

  it('names the untargeted universal fallback the way vsce does', () => {
    const name = vsixFallbackName('muse-spark-code', '0.19.0')
    expect(name).toBe('muse-spark-code-0.19.0.vsix')
    expect(targetOfVsix(name)).toBeUndefined()
  })

  it('refuses unknown targets instead of packaging them silently', () => {
    expect(() => vsixArtifactName('muse-spark-code', '0.19.0', 'linux-armhf')).toThrow()
    expect(() => isVsixTargetFile('web', 'dist/extension.js')).toThrow()
    expect(targetOfVsix('muse-spark-code-linux-armhf-0.19.0.vsix')).toBeUndefined()
  })

  it('reads --target, defaulting to the universal package without the flag', () => {
    expect(targetFromArgs([])).toBeUndefined()
    for (const target of VSIX_TARGETS) expect(targetFromArgs(['--target', target])).toBe(target)
  })

  it('refuses an unknown or missing --target before staging anything', () => {
    for (const argv of [['--target', 'linux-armhf'], ['--target'], ['--target', 'web']]) {
      expect(() => targetFromArgs(argv)).toThrow('Unknown VSIX target')
    }
  })
})
