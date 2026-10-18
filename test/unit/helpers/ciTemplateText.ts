// The other-CI templates' text: each system's file, its generated shared
// bootstrap, and the bootstrap's source with the launcher's real key-name
// list substituted, exactly as scripts/sync-ci-bootstrap.mjs generates it.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CI_BOOTSTRAP_UNSET } from '../../../action/lib/ci-run.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')

const FILES: Record<string, string> = {
  gitlab: 'gitlab-ci.yml',
  azure: 'azure-pipelines.yml',
  jenkins: 'Jenkinsfile',
  bitbucket: 'bitbucket-pipelines.yml',
}

export function templateText(system: string): string {
  const file = FILES[system]
  if (file === undefined) throw new Error(`no template for ${system}`)
  return readFileSync(path.join(REPO_ROOT, 'ci-templates', file), 'utf8')
}

/** The source of truth: ci-templates/bootstrap.sh with its trailing newline cut. */
export function bootstrapSource(): string {
  return readFileSync(path.join(REPO_ROOT, 'ci-templates', 'bootstrap.sh'), 'utf8')
    .replace(/\n$/, '')
    .split('@MUSE_KEY_NAMES@')
    .join(CI_BOOTSTRAP_UNSET.join(' '))
}

/** The shared bootstrap: the generated block between the template's markers. */
export function bootstrapOf(system: string): string {
  const lines = templateText(system).split('\n')
  const begin = lines.findIndex((line) => line.includes('BEGIN MUSE BOOTSTRAP'))
  const end = lines.findIndex((line) => line.includes('END MUSE BOOTSTRAP'))
  if (begin === -1 || end === -1 || end <= begin + 1) {
    throw new Error(`no generated bootstrap in ${system}`)
  }
  return lines
    .slice(begin + 1, end)
    .map((line) => line.trimStart())
    .join('\n')
}
