#!/usr/bin/env node
// The real-use setup (lane REALUSECI): the keyless half of the `realuse` job.
// It proves the candidate tarball is the input ref's commit (name, file count
// and SHA-256), installs it outside the workspace with scripts disabled, and
// resolves its bin script the way the Action's installer does (canonical,
// inside the package, a regular file). Then it plants the startup traps that
// catch a child sourcing a shell or Node hook. It never receives the key, so
// a failure here stops the run before any secret exists. Anything it writes
// to $GITHUB_OUTPUT is a path or a digest, never a credential.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseFlagArgs, RealUseInputError } from './lib/real-use.mjs'

const AGENT_PACKAGE = 'muse-spark-code-acp'
const INSTALL_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund']

const WANTED_FLAGS = [
  '--ref-root',
  '--candidate-dir',
  '--package-commit',
  '--package-name',
  '--package-sha256',
  '--agent-dir',
  '--traps-dir',
]

function fail(message) {
  process.stderr.write(`real-use-setup: ${message}\n`)
  process.exitCode = 1
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.on('end', () => resolve(digest.digest('hex')))
  })
}

/** The installed package's bin script: canonical, inside the package, a file. */
function agentScript(agentDir) {
  const directory = realpathSync(path.join(agentDir, 'node_modules', AGENT_PACKAGE))
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest?.name !== AGENT_PACKAGE) throw new Error('package identity')
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[AGENT_PACKAGE]
  if (typeof bin !== 'string') throw new TypeError('package bin')
  const script = realpathSync(path.resolve(directory, bin))
  const relative = path.relative(directory, script)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !statSync(script).isFile()) {
    throw new Error('package bin')
  }
  return script
}

async function main() {
  let options
  try {
    options = parseFlagArgs(process.argv.slice(2), WANTED_FLAGS)
  } catch (error) {
    fail(error instanceof RealUseInputError ? error.message : 'arguments unreadable')
    return
  }
  const head = spawnSync('git', ['-C', options.refRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (head.status !== 0 || head.stdout.trim() !== options.packageCommit) {
    fail('the ref tree is not the packaged commit')
    return
  }
  const files = readdirSync(options.candidateDir)
  if (files.length !== 1 || files[0] !== options.packageName) {
    fail('the candidate folder does not hold exactly the recorded package')
    return
  }
  const candidate = path.join(options.candidateDir, files[0])
  if (!statSync(candidate).isFile()) {
    fail('the candidate is not a regular file')
    return
  }
  if ((await sha256File(candidate)) !== options.packageSha256) {
    fail('the candidate does not match its recorded SHA-256')
    return
  }
  const install = spawnSync(
    'npm',
    ['install', '--prefix', options.agentDir, ...INSTALL_FLAGS, candidate],
    {
      encoding: 'utf8',
    },
  )
  if (install.status !== 0) {
    fail('npm could not install the agent package')
    return
  }
  let agentJs
  try {
    agentJs = agentScript(options.agentDir)
  } catch {
    fail('the installed package has no usable bin script')
    return
  }
  mkdirSync(options.trapsDir, { recursive: true })
  writeFileSync(
    path.join(options.trapsDir, 'bash-env.sh'),
    `: > "${options.trapsDir}/fired-bash-env"\n`,
  )
  writeFileSync(path.join(options.trapsDir, 'env.sh'), `: > "${options.trapsDir}/fired-env"\n`)
  writeFileSync(
    path.join(options.trapsDir, 'trap.cjs'),
    `require("node:fs").writeFileSync(require("node:path").join(${JSON.stringify(options.trapsDir)}, "fired-node-options-" + process.pid), "")\n`,
  )
  const output = process.env.GITHUB_OUTPUT
  if (typeof output !== 'string' || output === '') {
    fail('GITHUB_OUTPUT is missing')
    return
  }
  writeFileSync(
    output,
    `agent-js=${agentJs}\ntraps=${options.trapsDir}\nsha256=${options.packageSha256}\n`,
    { flag: 'a' },
  )
}

await main()
