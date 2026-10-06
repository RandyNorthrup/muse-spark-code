// Fake-only staging; this never runs in a publishing job.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stageNodeImage } from '../../scripts/package-node-image.mjs'

const fixture = path.resolve('test/fixtures/node-image')
const runtime = path.resolve('temp/m110-fake-runtime')
mkdirSync(path.join(runtime, 'dist'), { recursive: true })
for (const [input, output] of [
  ['node.mjs', 'node.js'],
  ['tool-host.mjs', 'nodeToolHost.js'],
  ['acp.mjs', 'acp.js'],
]) {
  cpSync(path.join(fixture, input), path.join(runtime, 'dist', output))
}
for (const file of ['package.json', 'package-lock.json'])
  cpSync(path.join(fixture, file), path.join(runtime, file))
cpSync('LICENSE', path.join(runtime, 'LICENSE'))
writeFileSync(path.join(runtime, 'THIRD_PARTY_NOTICES.txt'), readFileSync('LICENSE'))
stageNodeImage(runtime, path.resolve('temp/m110-fake-context'))
