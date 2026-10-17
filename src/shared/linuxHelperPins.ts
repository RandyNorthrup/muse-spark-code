// The Linux dictation helper's release pins (CM9LNX, PLAN.md D140).
//
// The helper is NOT packaged in the VSIX. The release workflow builds it
// for x64 and arm64, publishes each file as a release asset of the same
// tag, and regenerates this module with
// `node scripts/build-linux-helper-pins.mjs` before packaging, so the
// shipped extension embeds the exact SHA-256 of every asset it may
// download. `node scripts/check-linux-helper-pins.mjs` refuses a build
// whose pins do not match the uploaded assets.
//
// Committed values are UNSET (bytes 0, sha256 ''): a build without the
// release helpers refuses every helper download instead of trusting
// anything, and the consent card never appears for it. Only this module
// (read by dist/voice.js on the first recording) carries the pins, so the
// activation bundle does not (PLAN.md D6).

export interface LinuxHelperFilePin {
  /** The release asset's file name, stable across releases (no version). */
  readonly asset: string
  /** The file's name inside the download folder. */
  readonly file: string
  /** Exact asset bytes; 0 when not yet pinned by a release build. */
  readonly bytes: number
  /** Lowercase hex SHA-256; '' when not yet pinned. */
  readonly sha256: string
  /** The helper binary runs; its libraries never do. */
  readonly isExecutable: boolean
}

export type LinuxHelperArch = 'x64' | 'arm64'

const RELEASE_BASE_URL = 'https://github.com/RandyNorthrup/muse-spark-code/releases/latest/download'

function filePin(
  asset: string,
  file: string,
  bytes: number,
  sha256: string,
  isExecutable: boolean,
): LinuxHelperFilePin {
  return { asset, file, bytes, sha256, isExecutable }
}

/** Every helper file one architecture downloads, in install order. */
export const LINUX_HELPER_PINS: Record<LinuxHelperArch, readonly LinuxHelperFilePin[]> = {
  // BEGIN GENERATED PINS (scripts/build-linux-helper-pins.mjs rewrites the
  // bytes/sha256 fields between these markers; keep the assets and order).
  x64: [
    filePin('linux-x64-muse-dictate', 'muse-dictate', 0, '', true),
    filePin('linux-x64-libwhisper.so.1', 'libwhisper.so.1', 0, '', false),
    filePin('linux-x64-libggml.so', 'libggml.so', 0, '', false),
    filePin('linux-x64-libggml-base.so', 'libggml-base.so', 0, '', false),
    filePin('linux-x64-libggml-cpu-x64.so', 'libggml-cpu-x64.so', 0, '', false),
  ],
  arm64: [
    filePin('linux-arm64-muse-dictate', 'muse-dictate', 0, '', true),
    filePin('linux-arm64-libwhisper.so.1', 'libwhisper.so.1', 0, '', false),
    filePin('linux-arm64-libggml.so', 'libggml.so', 0, '', false),
    filePin('linux-arm64-libggml-base.so', 'libggml-base.so', 0, '', false),
    filePin('linux-arm64-libggml-cpu-armv8.0_1.so', 'libggml-cpu-armv8.0_1.so', 0, '', false),
  ],
  // END GENERATED PINS
}

/** The pinned files for this architecture, or undefined elsewhere. */
export function linuxHelperPins(arch: string): readonly LinuxHelperFilePin[] | undefined {
  return arch === 'x64' || arch === 'arm64' ? LINUX_HELPER_PINS[arch] : undefined
}

/** Where a pinned file downloads from: the same tag's release assets. */
export function linuxHelperUrl(pin: LinuxHelperFilePin): string {
  return `${RELEASE_BASE_URL}/${pin.asset}`
}

/** Every pin carries real release bytes and digests (the release build's). */
export function hasLinuxHelperPins(pins: readonly LinuxHelperFilePin[]): boolean {
  return (
    pins.length > 0 &&
    pins.every(
      (pin) =>
        Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && /^[0-9a-f]{64}$/.test(pin.sha256),
    )
  )
}

/** The first-download bytes the consent card names (pins set, one arch). */
export function linuxHelperBytes(pins: readonly LinuxHelperFilePin[]): number {
  return pins.reduce((total, pin) => total + pin.bytes, 0)
}
