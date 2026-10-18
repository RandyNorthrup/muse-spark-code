// Regenerate the Linux dictation helper's release pins from built helpers
// (CM9LNX, PLAN.md D140). The release workflow builds both architectures,
// publishes each file as a same-tag release asset, then runs this script
// before packaging so the shipped extension embeds the exact SHA-256 of
// every asset it may download:
//
//   node scripts/build-linux-helper-pins.mjs native/linux/x64 native/linux/arm64
//
// Only the bytes/sha256 fields between the GENERATED PINS markers and the
// release tag between the GENERATED RELEASE TAG markers move; asset names,
// file names, order and executable flags stay exactly as committed.
// `node scripts/check-linux-helper-pins.mjs` verifies the result,
// including against the uploaded assets.
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PINS_MODULE = path.join('src', 'shared', 'linuxHelperPins.ts')
// The full install set per architecture: the binary, whisper, ggml, and
// every CPU backend variant the GGML_CPU_ALL_VARIANTS build emits for
// Linux (ggml/src/CMakeLists.txt: x86 tags, then the Linux ARM tags), so
// the published assets match what `ggml_backend_load_all` can select.
export const EXPECTED = {
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

/** SHA-256 and size of one built helper file; refuses empty files. */
export function hashHelperFile(file) {
  const info = statSync(file)
  if (!info.isFile() || info.size === 0) throw new Error(`Helper file is missing or empty: ${file}`)
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  return { bytes: info.size, sha256 }
}

const ARCHES = ['x64', 'arm64']
// A pin call in the single-line form or prettier's broken form (real
// digests push long pins past print width): the committed module carries
// both, and stamping must read both.
const PIN_LINE =
  /^[ \t]*filePin\(\s*'([^']+)',\s*'([^']+)',\s*\d+,\s*'[0-9a-f]*',\s*(?:true|false)\s*,?\s*\)/gm
const TAG_LINE = /^const RELEASE_TAG = '[^']*'$/m
// .prettierrc's printWidth: a stamped line longer than this is emitted in
// the broken form prettier itself uses, so the stamped tree stays clean.
const PRINT_WIDTH = 100

/** Rewrite only the bytes/sha256 of the committed pins and the release tag. */
export function writePinsModule(text, measured, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Not a release tag: ${tag}`)
  if (!TAG_LINE.test(text)) throw new Error('Committed pins lack the RELEASE_TAG line')
  const seen = { x64: new Set(), arm64: new Set() }
  const rewritten = text.replaceAll(PIN_LINE, (whole, asset, file) => {
    let arch
    if (asset.includes('-x64-')) arch = 'x64'
    else if (asset.includes('-arm64-')) arch = 'arm64'
    if (arch === undefined || measured[arch]?.[file] === undefined)
      throw new Error(`No measured helper for committed pin ${asset} (${file})`)
    seen[arch].add(file)
    const { bytes, sha256 } = measured[arch][file]
    const flag = /,\s*true\s*,?\s*\)$/.test(whole) ? 'true' : 'false'
    const single = `filePin('${asset}', '${file}', ${String(bytes)}, '${sha256}', ${flag})`
    const indent = whole.match(/^[ \t]*/)[0]
    if ((indent + single).length <= PRINT_WIDTH) return `${indent}${single}`
    return [
      `${indent}filePin(`,
      `${indent}  '${asset}',`,
      `${indent}  '${file}',`,
      `${indent}  ${String(bytes)},`,
      `${indent}  '${sha256}',`,
      `${indent}  ${flag},`,
      `${indent})`,
    ].join('\n')
  })
  for (const arch of ARCHES) {
    const wanted = EXPECTED[arch]
    for (const file of wanted) {
      if (!seen[arch].has(file)) throw new Error(`Committed pins lack ${arch}/${file}`)
    }
  }
  return rewritten.replace(TAG_LINE, () => `const RELEASE_TAG = '${tag}'`)
}

function measure(directory, arch) {
  const measured = {}
  const wanted = EXPECTED[arch]
  for (const file of wanted) {
    measured[file] = hashHelperFile(path.join(directory, file))
  }
  return measured
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const [x64dir, arm64dir] = process.argv.slice(2)
    if (x64dir === undefined || arm64dir === undefined || process.argv.length !== 4)
      throw new Error('Usage: node scripts/build-linux-helper-pins.mjs <x64dir> <arm64dir>')
    const text = readFileSync(PINS_MODULE, 'utf8')
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version
    const rewritten = writePinsModule(
      text,
      {
        x64: measure(x64dir, 'x64'),
        arm64: measure(arm64dir, 'arm64'),
      },
      `v${String(version)}`,
    )
    if (rewritten === text) console.log('Helper pins already match the built helpers')
    else {
      writeFileSync(PINS_MODULE, rewritten)
      console.log(`Helper pins regenerated in ${PINS_MODULE}`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
