// A test-owned fake of npm's CLI scripts (npm-cli.js and npx-cli.js) for the
// Action's install tests (M80 lane C, G13/G22). It makes no network call.
// Its scenario is fake-npm.json in its working directory (the private
// work/agent folder); it appends its argv and environment to
// fake-npm-report.jsonl there. `install` lays out an installed package and
// lock as the scenario says; `audit signatures` prints the scenario's
// verifier JSON, as `npm audit signatures --json --include-attestations` would.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const scenario = JSON.parse(readFileSync('fake-npm.json', 'utf8'))
appendFileSync('fake-npm-report.jsonl', `${JSON.stringify({ args, env: process.env })}\n`)

if (args.includes('audit')) {
  process.stdout.write(JSON.stringify(scenario.audit), () => {
    process.exit(scenario.auditExit ?? 0)
  })
} else if (scenario.installExit !== undefined && scenario.installExit !== 0) {
  process.exit(scenario.installExit)
} else {
  const name = 'muse-spark-code-acp'
  const directory = path.join('node_modules', name)
  mkdirSync(path.join(directory, 'dist'), { recursive: true })
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name,
      version: scenario.version,
      bin: scenario.bin ?? { [name]: 'dist/acp.js' },
    }),
  )
  writeFileSync(path.join(directory, 'dist', 'acp.js'), '// fake agent bundle\n')
  writeFileSync(
    'package-lock.json',
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        [`node_modules/${name}`]: {
          version: scenario.lockVersion ?? scenario.version,
          resolved: scenario.resolved,
          integrity: scenario.integrity,
        },
      },
    }),
  )
}
