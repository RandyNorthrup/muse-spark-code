// The other-CI templates' text and the exact shell each system runs from
// them (lane CM80CI-R2): GitLab's script list, Azure's bash step, the
// Jenkins stage's sh body and Bitbucket's step script, read through the
// repository's YAML parser (Jenkins by its declarative structure).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { REPO_ROOT } from './actionFixtures'

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

function mapping(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a mapping')
  }
  return value as Record<string, unknown>
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('expected a list of commands')
  }
  return value as string[]
}

/** The Muse Spark stage of the Jenkinsfile, from its header to the stages' end. */
export function jenkinsStage(text: string): string {
  const start = text.indexOf("stage('Muse Spark')")
  if (start === -1) throw new Error('no Muse Spark stage')
  return text.slice(start)
}

/** Everything the system's shell runs for the template, in order. */
export function scriptOf(system: string): string {
  const text = templateText(system)
  switch (system) {
    case 'gitlab': {
      return strings(mapping(mapping(parse(text))['muse-spark'])['script']).join('\n')
    }
    case 'azure': {
      const job = mapping((mapping(parse(text))['jobs'] as unknown[])[0])
      const step = (job['steps'] as unknown[])
        .map((item) => mapping(item))
        .find((item) => 'bash' in item)
      return String(step?.['bash'])
    }
    case 'jenkins': {
      const stage = jenkinsStage(text)
      const open = stage.indexOf("sh '''") + "sh '''".length
      return stage.slice(open, stage.indexOf("'''", open))
    }
    default: {
      const steps = mapping(mapping(parse(text))['definitions'])['steps'] as unknown[]
      return strings(mapping(mapping(steps[0])['step'])['script']).join('\n')
    }
  }
}

/** The source of truth: ci-templates/bootstrap.sh with its trailing newline cut. */
export function bootstrapSource(): string {
  return readFileSync(path.join(REPO_ROOT, 'ci-templates', 'bootstrap.sh'), 'utf8').replace(
    /\n$/,
    '',
  )
}

/** The shared bootstrap: the generated block between the template's markers. */
export function bootstrapOf(system: string): string {
  const lines = templateText(system).split('\n')
  const begin = lines.findIndex((line) => line.includes('BEGIN MUSE BOOTSTRAP'))
  const end = lines.findIndex((line) => line.includes('END MUSE BOOTSTRAP'))
  if (begin === -1 || end === -1 || end <= begin + 1) {
    throw new Error(`no generated bootstrap in ${system}`)
  }
  return lines.slice(begin + 1, end).join('\n')
}
