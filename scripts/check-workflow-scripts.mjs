#!/usr/bin/env node
// Every `node scripts/...` step in a workflow job runs with only what that
// job installed. A job that has run no `npm ci` or `npm install` before the
// step has no node_modules, so the script, and every file it reaches
// through relative imports, may import Node's built-in modules only.
// A 0.19.0 release tag was refused this way: the browser check's pin check gained a
// zod import, and the release's tag-checks job never installed anything
// (docs/certification/cifinal0190.md section 16).
//
// Imports are read the way Node will load them: esbuild bundles each script
// with every package left external and reports, in its metafile, each file
// reached and each import that stays outside the bundle. A step that runs
// before its job's install and imports a package fails the check, naming
// the workflow, the job, the step, the script, the package and the file
// that imports it.
//
//   node scripts/check-workflow-scripts.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { parse } from 'yaml'

const root = path.resolve(import.meta.dirname, '..')
const WORKFLOWS = path.join(root, '.github', 'workflows')
const INSTALL = /\bnpm\s+(?:ci|install|i)\b/
const NODE_SCRIPT = /\bnode\s+(?:\.\/)?([\w./-]+\.[cm]?js)\b/g
const builtins = new Set(builtinModules)

/** Whether `specifier` names one of Node's built-in modules. */
function isBuiltin(specifier) {
  return specifier.startsWith('node:') || builtins.has(specifier.split('/', 1)[0])
}

/** Each package `script` imports, directly or through its relative imports, with the importing file. */
async function packageImports(script) {
  const { metafile } = await build({
    entryPoints: [script],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  })
  const found = []
  for (const [file, input] of Object.entries(metafile.inputs)) {
    for (const entry of input.imports) {
      if (entry.external === true && !isBuiltin(entry.path)) {
        found.push({ specifier: entry.path, file })
      }
    }
  }
  return found
}

/** The repository's scripts each `run` text starts with `node`, resolved from `directory`. */
function scriptsRunBy(run, directory) {
  const scripts = []
  for (const match of run.matchAll(NODE_SCRIPT)) {
    const script = path.resolve(directory, match[1])
    if (existsSync(script) && script.startsWith(path.join(root, 'scripts'))) {
      scripts.push(script)
    }
  }
  return scripts
}

/** One job's steps in order: each script it runs and whether the job has installed by then. */
function scriptSteps(job, jobId) {
  const found = []
  let hasInstalled = false
  const jobDirectory = job?.defaults?.run?.['working-directory'] ?? '.'
  const steps = job?.steps ?? []
  for (const [index, step] of steps.entries()) {
    if (typeof step?.run !== 'string') {
      continue
    }
    const directory = path.resolve(root, step['working-directory'] ?? jobDirectory)
    const where = `${job?.name ?? jobId} › ${step.name ?? `step ${String(index + 1)}`}`
    for (const script of scriptsRunBy(step.run, directory)) {
      found.push({ where, script, hasInstalled })
    }
    hasInstalled ||= INSTALL.test(step.run)
  }
  return found
}

const problems = []
let stepCount = 0
let beforeInstall = 0
const workflowFiles = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .toSorted((left, right) => left.localeCompare(right))
for (const name of workflowFiles) {
  const workflow = parse(readFileSync(path.join(WORKFLOWS, name), 'utf8'))
  const jobs = Object.entries(workflow?.jobs ?? {})
  for (const [jobId, job] of jobs) {
    for (const { where, script, hasInstalled } of scriptSteps(job, jobId)) {
      stepCount += 1
      if (hasInstalled) {
        continue
      }
      beforeInstall += 1
      const shown = path.relative(root, script).split(path.sep).join('/')
      const imports = await packageImports(script)
      for (const { specifier, file } of imports) {
        problems.push(
          `${name} › ${where}: node ${shown} imports '${specifier}' (${file}), and the job installs nothing before this step`,
        )
      }
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`::error::${problem}`)
  }
  process.exit(1)
}
console.log(
  `ok   ${String(stepCount)} workflow steps run scripts/; the ${String(beforeInstall)} before their job's install import Node's built-in modules only`,
)
