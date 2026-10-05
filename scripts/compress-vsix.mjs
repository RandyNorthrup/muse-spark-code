// D6's unchanged cap: compact only UI JSON whitespace, preserve every value
// and all other asset bytes, then use maximum DEFLATE and atomic replacement.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { tableLayout } from './lib/packedL10n.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
const source = process.argv[2] ?? `${name}-${version}.vsix`
const script = fileURLToPath(new URL('compress-vsix.py', import.meta.url))
const layoutDirectory = mkdtempSync(path.join(tmpdir(), 'muse-l10n-'))
const layoutFile = path.join(layoutDirectory, 'layout.json')
writeFileSync(
  layoutFile,
  JSON.stringify(tableLayout(createRequire(import.meta.url)('../dist/uiText.js').EN)),
)
process.on('exit', () => {
  rmSync(layoutDirectory, { recursive: true, force: true })
})
for (const python of ['python3', 'python', 'py']) {
  const result = spawnSync(python, [script, path.resolve(source), layoutFile], { stdio: 'inherit' })
  if (result.error?.code === 'ENOENT') continue
  if (result.error !== undefined) throw result.error
  process.exit(result.status ?? 1)
}
throw new Error('VSIX compression requires Python (also used by the security:sast gate)')
