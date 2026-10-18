import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARWIN_HELPER, LINUX_HELPERS, acpHelperPlan } from '../../scripts/lib/acpNativeSources.mjs'

// The agent's packager carries only its own platform's built helpers
// (scripts/package-acp.mjs): a helper this machine builds stays required,
// one only another OS builds is skipped. A wrong row here either stops a
// dev machine packing with helpers it cannot build, or ships a person a
// package missing the helper their platform runs.
const linux = (arch, helper) => path.join('native', 'linux', arch, helper)

describe('agent helper plan', () => {
  it('requires the darwin helper and skips the linux ones on macOS', () => {
    expect(acpHelperPlan('darwin', 'x64')).toEqual({
      required: [DARWIN_HELPER],
      optional: [...LINUX_HELPERS],
    })
    expect(acpHelperPlan('darwin', 'arm64').required).toEqual([DARWIN_HELPER])
  })

  it('requires only its own architecture on linux', () => {
    expect(acpHelperPlan('linux', 'x64')).toEqual({
      required: [linux('x64', 'muse-created'), linux('x64', 'muse-vault-peer')],
      optional: [DARWIN_HELPER, linux('arm64', 'muse-created'), linux('arm64', 'muse-vault-peer')],
    })
    expect(acpHelperPlan('linux', 'arm64')).toEqual({
      required: [linux('arm64', 'muse-created'), linux('arm64', 'muse-vault-peer')],
      optional: [DARWIN_HELPER, linux('x64', 'muse-created'), linux('x64', 'muse-vault-peer')],
    })
  })

  it('requires no built helper on windows, where the C# compiles on first use', () => {
    expect(acpHelperPlan('win32', 'x64')).toEqual({
      required: [],
      optional: [DARWIN_HELPER, ...LINUX_HELPERS],
    })
  })

  it('refuses an unknown platform or architecture instead of packing silently', () => {
    expect(() => acpHelperPlan('freebsd', 'x64')).toThrow('Unknown ACP packager platform')
    expect(() => acpHelperPlan('linux', 'riscv64')).toThrow('Unknown ACP packager architecture')
  })
})
