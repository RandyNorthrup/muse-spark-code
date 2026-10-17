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
const EXPECTED = {
  x64: ['muse-dictate', 'libwhisper.so.1', 'libggml.so', 'libggml-base.so', 'libggml-cpu-x64.so'],
  arm64: [
    'muse-dictate',
    'libwhisper.so.1',
    'libggml.so',
    'libggml-base.so',
    'libggml-cpu-armv8.0_1.so',
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
const PIN_LINE = /^[ \t]*filePin\('([^']+)', '([^']+)', \d+, '[0-9a-f]*', (?:true|false)\)/gm
const TAG_LINE = /^const RELEASE_TAG = '[^']*'$/m

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
    return `filePin('${asset}', '${file}', ${String(bytes)}, '${sha256}', ${whole.endsWith(', true)') ? 'true' : 'false'})`
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
