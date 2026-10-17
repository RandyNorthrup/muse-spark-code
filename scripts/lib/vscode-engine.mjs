// The oldest VS Code the manifest accepts (`engines.vscode`, "^1.99.0"),
// for the integration tests' second run (.vscode-test.mjs) and the CI cache
// key (scripts/vscode-versions.mjs). Read from package.json so the tested
// floor moves with the declared one (M26, PLAN.md D29).

import { readFileSync } from 'node:fs'

const ENGINE_RANGE = /^\^(\d+\.\d+\.\d+)$/

export function minimumVsCodeVersion() {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const version = ENGINE_RANGE.exec(manifest.engines.vscode)?.[1]
  if (version === undefined) {
    throw new Error(`engines.vscode "${manifest.engines.vscode}" is not a caret range (^x.y.z)`)
  }
  return version
}
