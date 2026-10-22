#!/usr/bin/env node
// The rented-server artifact verifier (M110f lane S, D90.20): before the
// installer runs, this checks the artifact directory it was given. Every
// file named in SHA256SUMS must exist and match its hash, the artifact
// must hold at least one file, and no file may carry private key
// material. Exit 0 when it all holds, 1 naming the violation, 2 on
// missing input. Self-contained: the installer runs it where it lands.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const MANIFEST = 'SHA256SUMS'
const KEY_SMELL = 'PRIVATE KEY'

function fail(message) {
  process.stderr.write(`verify-node-install: ${message}\n`)
  process.exit(1)
}

function usage() {
  process.stderr.write('usage: verify-node-install.mjs <artifact-dir>\n')
  process.exit(2)
}

function listFiles(root) {
  const found = []
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name)
      const stat = statSync(file)
      if (stat.isDirectory()) visit(file)
      else if (stat.isFile()) found.push(file)
    }
  }
  visit(root)
  return found.toSorted((left, right) => {
    if (left === right) return 0
    return left < right ? -1 : 1
  })
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const [input] = process.argv.slice(2)
if (input === undefined || input === '') usage()
let root
try {
  root = realpathSync(input)
} catch {
  usage()
}
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) usage()

const manifestPath = path.join(root, MANIFEST)
let manifest
try {
  manifest = readFileSync(manifestPath, 'utf8')
} catch {
  fail(`no ${MANIFEST} in ${root}`)
}
const entries = manifest
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '')
if (entries.length === 0) fail(`no entries in ${MANIFEST}`)
for (const line of entries) {
  const [hash, name] = line.split(/\s+/, 2)
  if (hash === undefined || name === undefined || !/^[0-9a-f]{64}$/.test(hash)) {
    fail(`bad manifest line: ${line}`)
  }
  const target = path.normalize(path.join(root, name))
  if (!target.startsWith(root + path.sep)) fail(`manifest escapes its directory: ${name}`)
  if (!statSync(target, { throwIfNoEntry: false })?.isFile()) fail(`missing artifact file: ${name}`)
  if (sha256Of(target) !== hash) fail(`checksum mismatch: ${name}`)
}
const files = listFiles(root)
if (files.length === 0) fail('the artifact holds no files')
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (text.includes(KEY_SMELL)) fail(`private key material in ${path.relative(root, file)}`)
}
process.stdout.write(`verified ${String(entries.length)} files in ${root}\n`)
