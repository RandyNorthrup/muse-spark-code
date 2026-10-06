// M103-A: stage the regular allowlist, then lower only the host floors.
// Run after the production Arduino build and the usual build gates.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pack } from '@vscode/vsce/out/package.js'
import { stageVsix } from './package-vsix.mjs'
import { requireArduinoBuild } from './lib/arduinoBuild.mjs'

export async function stageArduinoVsix(root) {
  const record = JSON.parse(readFileSync(path.join(root, 'dist/build-profile.json'), 'utf8'))
  requireArduinoBuild(record)
  const stage = path.join(root, 'dist', 'vsix-package')
  const files = await stageVsix(root, stage)
  const manifestPath = path.join(stage, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.engines.vscode = record.vscode
  manifest.engines.node = record.node
  manifest.devDependencies['@types/vscode'] = '1.96.0'
  return { stage, files, manifest }
}

async function main() {
  // All existing gates run on the variant's output, including future maker bundles.
  for (const script of [
    'check-bundle-size',
    'check-bundle-split',
    'check-host-globals',
    'third-party-notices',
  ]) {
    execFileSync(process.execPath, [`scripts/${script}.mjs`], { stdio: 'inherit' })
  }
  const root = process.cwd()
  const { stage, manifest } = await stageArduinoVsix(root)
  execFileSync(process.execPath, ['scripts/check-l10n.mjs', '--packaged', stage], {
    stdio: 'inherit',
  })
  // The localization gate requires source-identical JSON. Check those bytes
  // first, then apply the non-text engine fields and matching type pin.
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest))
  const archive = path.join(root, `${manifest.name}-${manifest.version}-arduino.vsix`)
  await pack({ cwd: stage, dependencies: false, packagePath: archive })
  execFileSync(process.execPath, ['scripts/check-vsix-size.mjs', archive], { stdio: 'inherit' })
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main()
}
