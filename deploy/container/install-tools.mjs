// Download only the exact release artifacts whose SHA-256 is recorded here.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const pins = JSON.parse(readFileSync(new URL('tool-pins.json', import.meta.url), 'utf8'))
const architecture = { x64: 'amd64', arm64: 'arm64' }[process.arch]
if (!architecture || process.platform !== 'linux')
  throw new Error('Linux amd64/arm64 tool host required')
const directory = path.resolve(process.argv[2])
mkdirSync(directory, { recursive: true })
for (const [name, tool] of Object.entries(pins.tools)) {
  const pin = tool[architecture]
  const response = await fetch(
    `https://github.com/${tool.repository}/releases/download/${tool.version}/${pin.asset}`,
    { signal: globalThis.AbortSignal.timeout(120_000) },
  )
  if (!response.ok) throw new Error('Pinned tool download failed')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
    throw new Error('Pinned tool SHA-256 mismatch')
  if (pin.member) {
    const archive = path.join(directory, `${name}.tar.gz`)
    writeFileSync(archive, bytes)
    execFileSync('tar', ['-xzf', archive, '-C', directory, pin.member])
    rmSync(archive)
  } else writeFileSync(path.join(directory, name), bytes)
  chmodSync(path.join(directory, name), 0o755)
}
