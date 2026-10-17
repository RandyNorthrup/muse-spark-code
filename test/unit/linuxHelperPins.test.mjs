import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { writePinsModule } from '../../scripts/build-linux-helper-pins.mjs'
import { checkShape, checkValues, loadPins } from '../../scripts/check-linux-helper-pins.mjs'

const SHA = 'a'.repeat(64)

function measured() {
  const files = {
    x64: ['muse-dictate', 'libwhisper.so.1', 'libggml.so', 'libggml-base.so', 'libggml-cpu-x64.so'],
    arm64: [
      'muse-dictate',
      'libwhisper.so.1',
      'libggml.so',
      'libggml-base.so',
      'libggml-cpu-armv8.0_1.so',
    ],
  }
  return Object.fromEntries(
    Object.entries(files).map(([arch, names]) => [
      arch,
      Object.fromEntries(names.map((name) => [name, { bytes: 3, sha256: SHA }])),
    ]),
  )
}

describe('linux helper release pins', () => {
  it('committed pins are shape-clean, unset, and never point at latest', async () => {
    const pins = await loadPins()
    expect(checkShape(pins)).toEqual([])
    expect(pins.hasLinuxHelperPins(pins.LINUX_HELPER_PINS.x64)).toBe(false)
    for (const pin of pins.LINUX_HELPER_PINS.x64) {
      expect(pins.linuxHelperUrl(pin)).not.toContain('/latest/')
    }
    // Unset pins must fail the value check, including the same-tag URL rule.
    expect(checkValues(pins).length).toBeGreaterThan(0)
  })

  it('stamping writes the release tag and digests into the real module text', () => {
    const text = readFileSync('src/shared/linuxHelperPins.ts', 'utf8')
    const stamped = writePinsModule(text, measured(), 'v1.2.3')
    expect(stamped).toContain("const RELEASE_TAG = 'v1.2.3'")
    expect(stamped).toContain(`filePin('linux-x64-muse-dictate', 'muse-dictate', 3, '${SHA}'`)
    expect(() => writePinsModule(text, measured(), 'latest')).toThrow('Not a release tag')
  })
})
