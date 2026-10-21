#!/usr/bin/env node
// Every workflow step that runs the repository's code with `node` runs with
// only what its job installed. A job that has run no `npm ci` or
// `npm install` before the step has no node_modules, so the file it runs
// (`node <file>`), every file inline code imports (`node -e "import ...
// from './scripts/...'"`), and every file those reach through relative
// imports may import Node's built-in modules only, and inline code may
// import no package itself.
// A 0.19.0 release tag was refused this way: the browser check's pin check gained a
// zod import, and the release's tag-checks job never installed anything
// (docs/certification/cifinal0190.md section 16).
//
// Imports are read the way Node will load them: esbuild bundles each script
// with every package left external and reports, in its metafile, each file
// reached and each import that stays outside the bundle. A step that runs
// before its job's install and imports a package fails the check, naming
// the workflow, the job, the step, the file it loads, the package and the
// file that imports it.
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
const NODE_FILE = /\bnode\s+(?:\.\/)?([\w./-]+\.[cm]?js)\b/g
// Inline code handed to node with -e, --eval, -p or --print, and the module
// specifiers it imports.
const NODE_INLINE = /\bnode\b[^\n]*?\s(?:-e|--eval|-p|--print)\s+(["'])([\s\S]*?)\1/g
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g
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

/** What a `run` text has node load: repository files, and packages inline code imports. */
function nodeEntriesOf(run, directory) {
  const entries = []
  const addFile = (relative) => {
    const file = path.resolve(directory, relative)
    if (existsSync(file) && file.startsWith(root + path.sep)) {
      entries.push({ file })
    }
  }
  for (const match of run.matchAll(NODE_FILE)) {
    addFile(match[1])
  }
  for (const inline of run.matchAll(NODE_INLINE)) {
    const specifiers = inline[2].matchAll(SPECIFIER)
    for (const [, specifier] of specifiers) {
      if (specifier.startsWith('.')) {
        addFile(specifier)
      } else if (!isBuiltin(specifier)) {
        entries.push({ specifier })
      }
    }
  }
  return entries
}

/** One job's steps in order: what each has node load, and whether the job has installed by then. */
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
    for (const entry of nodeEntriesOf(step.run, directory)) {
      found.push({ where, entry, hasInstalled })
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
    for (const { where, entry, hasInstalled } of scriptSteps(job, jobId)) {
      stepCount += 1
      if (hasInstalled) {
        continue
      }
      beforeInstall += 1
      if (entry.specifier !== undefined) {
        problems.push(
          `${name} › ${where}: inline node code imports '${entry.specifier}', and the job installs nothing before this step`,
        )
        continue
      }
      const shown = path.relative(root, entry.file).split(path.sep).join('/')
      const imports = await packageImports(entry.file)
      for (const { specifier, file } of imports) {
        problems.push(
          `${name} › ${where}: node loads ${shown}, which imports '${specifier}' (${file}), and the job installs nothing before this step`,
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
  `ok   ${String(stepCount)} files node loads in workflow steps; the ${String(beforeInstall)} loaded before their job's install import Node's built-in modules only`,
)
