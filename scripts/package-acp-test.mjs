#!/usr/bin/env node
// M80 W's unsigned, fake-only package. Run after package-acp.mjs. Keep the
// installed package identity so the candidate installer uses its normal path;
// the distinct tarball name and bin prevent release-artifact confusion.
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'

const SOURCE = path.resolve('dist', 'acp-package')
const STAGE = path.resolve('dist', 'acp-test-package')
const LAUNCHER = path.resolve('test', 'action', 'exec-test-launcher.ts')
const PACKAGE_NAME = 'muse-spark-code-acp'
const manifest = JSON.parse(readFileSync(path.join(SOURCE, 'package.json'), 'utf8'))
if (
  manifest.name !== PACKAGE_NAME ||
  manifest.bin?.[PACKAGE_NAME] !== 'dist/acp.js' ||
  typeof manifest.version !== 'string' ||
  !/^\d+\.\d+\.\d+$/.test(manifest.version)
) {
  throw new Error('package:acp must produce the production agent package first')
}
for (const file of [
  LAUNCHER,
  ...(process.platform === 'linux'
    ? [path.join(SOURCE, 'native', 'linux', process.arch, 'muse-created')]
    : []),
  ...[
    'acp.js',
    'mcpPool.js',
    'exec.js',
    'modelApiCodeIntel.js',
    'structuredSchema.js',
    'estimator.js',
    'modelApi.js',
    'recorder.js',
    'uiText.js',
    'uiTextRuntime.js',
    'uiTextHooks.js',
    'uiTextSurfaces.js',
    'validation.js',
    'wire.js',
    'resourceGovernor.js',
    'resourceProcess.js',
    'resourceJournal.js',
    'resourceAdmission.js',
    'runtime.bundles.json.br',
    'reporting.js',
    'reportingNetwork.js',
    'reportingDestinations.js',
  ].map((name) => path.join(SOURCE, 'dist', name)),
  ...[
    'exec-result-v1.schema.json',
    'exec-event-v1.schema.json',
    'exec-result-v2.schema.json',
    'exec-event-v2.schema.json',
  ].map((name) => path.join(SOURCE, 'schemas', name)),
]) {
  if (!statSync(file).isFile()) {
    throw new Error('the test launcher and production bundles/schemas must be regular files')
  }
}
rmSync(STAGE, { recursive: true, force: true })
cpSync(SOURCE, STAGE, { recursive: true })
await build({
  entryPoints: [LAUNCHER],
  outfile: path.join(STAGE, 'dist', 'exec-test-launcher.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['@napi-rs/keyring'],
  logLevel: 'silent',
})
manifest.bin = { [PACKAGE_NAME]: 'dist/exec-test-launcher.js' }
manifest.private = true
manifest.description =
  'UNSIGNED TEST ONLY: fake transport for M80 workflow acceptance; never release.'
writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
// Pack inside the test stage: npm's normal filename equals the production
// tarball's, so packing into dist would overwrite the reviewed product bytes.
const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', '.'], {
  cwd: STAGE,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
  .trim()
  .split('\n')
  .at(-1)
if (packed !== `${PACKAGE_NAME}-${manifest.version}.tgz`) {
  throw new Error('npm pack did not return a tarball name')
}
const destination = path.resolve('dist', `muse-spark-code-acp-test-${manifest.version}.tgz`)
renameSync(path.join(STAGE, packed), destination)
console.log(`${destination}: UNSIGNED TEST ONLY; production stage is unchanged`)
