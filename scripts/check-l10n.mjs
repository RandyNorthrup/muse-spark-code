#!/usr/bin/env node
// The strict source/packaged localization gate. The reusable checker compiles
// canonical source modules once and reads every current table on each call.
import process from 'node:process'
import { createLocalizationCheck } from './lib/localizationGate.mjs'

let check
try {
  check = await createLocalizationCheck(process.cwd())
} catch (error) {
  console.log(`src/shared/l10n could not be bundled: ${String(error.message ?? error)}`)
  process.exitCode = 1
}
if (check !== undefined) {
  const result = check(process.argv.slice(2))
  process.stdout.write(result.output)
  process.exitCode = result.code
}
