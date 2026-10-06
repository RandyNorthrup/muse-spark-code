#!/usr/bin/env node
// node scripts/stage-node-toolset.mjs <amd64|arm64> <new-build-context> [verified-cache]
import { copyFile, cp } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { readToolset, stageToolset } from './lib/nodeToolset.mjs'

const [architecture, destination, cache] = process.argv.slice(2)
if (destination === undefined || !['amd64', 'arm64'].includes(architecture))
  throw new Error(
    'Usage: stage-node-toolset.mjs <amd64|arm64> <new-build-context> [verified-cache]',
  )
const manifest = await readToolset('deploy/toolset/base.json')
const bytes = await stageToolset(
  manifest,
  architecture,
  path.resolve(destination),
  cache === undefined ? undefined : path.resolve(cache),
)
for (const file of ['Containerfile', 'install.sh'])
  await copyFile(path.join('deploy/toolset', file), path.join(destination, file))

// Repository release assets: the existing vendor/first-party gates verify their
// exact inventories. Runtime Muse Code copies additionally verify VENDOR hashes.
for (const folder of ['vendor', 'first-party-skills']) {
  await cp(folder, path.join(destination, 'assets', folder), {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  })
}
console.log(`${architecture}: staged ${String(bytes)} verified bytes for an offline build`)
