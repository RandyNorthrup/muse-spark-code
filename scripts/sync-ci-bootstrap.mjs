// Copies ci-templates/bootstrap.sh (the one POSIX bootstrap) into the four
// other-CI templates, replacing the @MUSE_SYSTEM@ token with the template's
// system.
// Run: node scripts/sync-ci-bootstrap.mjs. The template tests refuse drift.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CI_BOOTSTRAP_UNSET } from '../action/lib/ci-key.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'ci-templates', 'bootstrap.sh')

const TEMPLATES = [
  { file: path.join('ci-templates', 'gitlab-ci.yml'), system: 'gitlab' },
  { file: path.join('ci-templates', 'azure-pipelines.yml'), system: 'azure' },
  { file: path.join('ci-templates', 'Jenkinsfile'), system: 'jenkins' },
  { file: path.join('ci-templates', 'bitbucket-pipelines.yml'), system: 'bitbucket' },
]

function indentOf(line) {
  return line.slice(0, line.length - line.trimStart().length)
}

function sync({ file, system }) {
  const absolute = path.join(ROOT, file)
  const lines = readFileSync(absolute, 'utf8').split('\n')
  const begin = lines.findIndex((line) => line.includes('BEGIN MUSE BOOTSTRAP'))
  const end = lines.findIndex((line) => line.includes('END MUSE BOOTSTRAP'))
  if (begin === -1 || end === -1 || end <= begin + 1) {
    throw new Error(`${file}: bootstrap markers missing or empty`)
  }
  const inner = indentOf(lines[begin + 1] ?? lines[begin])
  const body = readFileSync(SOURCE, 'utf8')
    .replace(/\n$/, '')
    .split('@MUSE_KEY_NAMES@')
    .join(CI_BOOTSTRAP_UNSET.join(' '))
    .split('\n')
    .map((line) => `${inner}${line.split('@MUSE_SYSTEM@').join(system)}`)
  lines.splice(begin + 1, end - begin - 1, ...body)
  writeFileSync(absolute, lines.join('\n'))
}

for (const template of TEMPLATES) sync(template)
console.log(`bootstrap synced into ${TEMPLATES.length} templates`)
