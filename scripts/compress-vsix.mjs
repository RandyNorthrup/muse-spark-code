// D6's unchanged compressed-package cap: preserve all VSIX entries, then
// use maximum DEFLATE rather than the packer's default compression level.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
const source = process.argv[2] ?? `${name}-${version}.vsix`
const script = fileURLToPath(new URL('compress-vsix.py', import.meta.url))
for (const python of ['python3', 'python', 'py']) {
  const result = spawnSync(python, [script, path.resolve(source)], { stdio: 'inherit' })
  if (result.error?.code === 'ENOENT') continue
  if (result.error !== undefined) throw result.error
  process.exit(result.status ?? 1)
}
throw new Error('VSIX compression requires Python (also used by the security:sast gate)')
