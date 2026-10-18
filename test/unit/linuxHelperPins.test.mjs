import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXPECTED, writePinsModule } from '../../scripts/build-linux-helper-pins.mjs'
import { checkShape, checkValues, loadPins } from '../../scripts/check-linux-helper-pins.mjs'

const SHA = 'a'.repeat(64)

function measured() {
  const files = {
    x64: [
      'muse-dictate',
      'libwhisper.so.1',
      'libggml.so',
      'libggml-base.so',
      'libggml-cpu-x64.so',
      'libggml-cpu-sse42.so',
      'libggml-cpu-sandybridge.so',
      'libggml-cpu-haswell.so',
      'libggml-cpu-skylakex.so',
      'libggml-cpu-icelake.so',
      'libggml-cpu-alderlake.so',
      'libggml-cpu-sapphirerapids.so',
    ],
    arm64: [
      'muse-dictate',
      'libwhisper.so.1',
      'libggml.so',
      'libggml-base.so',
      'libggml-cpu-armv8.0_1.so',
      'libggml-cpu-armv8.2_1.so',
      'libggml-cpu-armv8.2_2.so',
      'libggml-cpu-armv8.2_3.so',
      'libggml-cpu-armv8.6_1.so',
      'libggml-cpu-armv8.6_2.so',
      'libggml-cpu-armv9.2_1.so',
      'libggml-cpu-armv9.2_2.so',
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

  it('committed pins cover exactly the install set the build emits', async () => {
    const pins = await loadPins()
    for (const arch of ['x64', 'arm64']) {
      expect(pins.LINUX_HELPER_PINS[arch].map((pin) => pin.file)).toEqual(EXPECTED[arch])
    }
  })

  it('stamping writes the release tag and digests into the real module text', () => {
    const text = readFileSync('src/shared/linuxHelperPins.ts', 'utf8')
    const stamped = writePinsModule(text, measured(), 'v1.2.3')
    expect(stamped).toContain("const RELEASE_TAG = 'v1.2.3'")
    expect(stamped).toContain(
      `      'linux-x64-muse-dictate',\n      'muse-dictate',\n      3,\n      '${SHA}',`,
    )
    // Long pins stamp into prettier's broken form, wrapped pins included.
    expect(stamped).toContain(
      `      'linux-x64-libggml-cpu-haswell.so',\n      'libggml-cpu-haswell.so',\n      3,\n      '${SHA}',`,
    )
    expect(stamped).toContain(
      `      'linux-x64-libggml-cpu-sapphirerapids.so',\n      'libggml-cpu-sapphirerapids.so',\n      3,\n      '${SHA}',`,
    )
    expect(() => writePinsModule(text, measured(), 'latest')).toThrow('Not a release tag')
  })
})
