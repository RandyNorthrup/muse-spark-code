import { describe, expect, it } from 'vitest'
import {
  JOB_SOURCES,
  LINUX_HELPERS,
  VOICE_WINDOWS_HELPERS,
  acpNativeFiles,
} from '../../scripts/lib/acpNativeSources.mjs'
import { VSIX_TARGETS } from '../../scripts/lib/vsixTargets.mjs'

// A platform's ACP package carries only its own helpers, so packaging it
// never demands a helper only another OS builds. A wrong row here ships
// a person a package missing the helper their platform runs, or refuses
// a package the platform could have built. Darwin lists no loose file:
// its one helper is the signed .app's executable, copied as a bundle
// beside these files (scripts/package-acp.mjs).
describe('per-platform ACP native inventory', () => {
  it('keeps the universal package whole without a target', () => {
    expect(acpNativeFiles()).toEqual([...JOB_SOURCES, ...LINUX_HELPERS, ...VOICE_WINDOWS_HELPERS])
  })

  it('stages only the target platform’s own helpers', () => {
    for (const target of VSIX_TARGETS) {
      const [platform, arch] = target.split('-', 2)
      const files = acpNativeFiles(target)
      if (platform === 'linux') {
        expect(files).toEqual(
          LINUX_HELPERS.filter((helper) => helper.replaceAll('\\', '/').split('/').includes(arch)),
        )
      } else if (platform === 'darwin') {
        expect(files).toEqual([])
      } else {
        expect(files).toEqual([...JOB_SOURCES, ...VOICE_WINDOWS_HELPERS])
      }
    }
  })

  it('refuses unknown targets instead of staging them silently', () => {
    for (const target of ['linux-armhf', 'web', '']) {
      expect(() => acpNativeFiles(target)).toThrow('Unknown ACP target')
    }
  })
})
