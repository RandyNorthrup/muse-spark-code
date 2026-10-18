import { describe, expect, it } from 'vitest'
import {
  DARWIN_HELPER,
  JOB_SOURCES,
  LINUX_HELPERS,
  acpNativeFiles,
} from '../../scripts/lib/acpNativeSources.mjs'
import { VSIX_TARGETS } from '../../scripts/lib/vsixTargets.mjs'

// A platform's ACP package carries only its own helpers, so packaging it
// never demands a helper only another OS builds. A wrong row here ships
// a person a package missing the helper their platform runs, or refuses
// a package the platform could have built.
describe('per-platform ACP native inventory', () => {
  it('keeps the universal package whole without a target', () => {
    expect(acpNativeFiles()).toEqual([...JOB_SOURCES, DARWIN_HELPER, ...LINUX_HELPERS])
  })

  it('stages only the target platform’s own helpers', () => {
    for (const target of VSIX_TARGETS) {
      const [platform, arch] = target.split('-', 2)
      const files = acpNativeFiles(target)
      if (platform === 'linux') {
        expect(files).toEqual([LINUX_HELPERS[arch === 'x64' ? 0 : 1]])
      } else if (platform === 'darwin') {
        expect(files).toEqual([DARWIN_HELPER])
      } else {
        expect(files).toEqual([...JOB_SOURCES])
      }
    }
  })

  it('refuses unknown targets instead of staging them silently', () => {
    for (const target of ['linux-armhf', 'web', '']) {
      expect(() => acpNativeFiles(target)).toThrow('Unknown ACP target')
    }
  })
})
