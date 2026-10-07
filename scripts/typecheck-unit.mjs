// Check the complete unit project in sequential processes. Releasing each
// TypeScript program keeps hosted macOS below its default Node heap limit.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CONFIG = path.join(ROOT, 'test/unit/tsconfig.json')
const config = ts.getParsedCommandLineOfConfigFile(
  CONFIG,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  },
)
if (config.errors.length > 0)
  throw new Error(
    config.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      .join('\n'),
  )

const TSC = fileURLToPath(import.meta.resolve('typescript/bin/tsc'))
const TESTS_PER_PROJECT = 200
const tests = []
const support = []
const shared = []
const files = config.fileNames.toSorted((left, right) => left.localeCompare(right, 'en'))
for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.includes('/test/unit/') && /\.test\.tsx?$/.test(normalized)) tests.push(file)
  else {
    support.push(file)
    // Keep global declarations and setup's Vitest matcher augmentation in
    // every program, as in the original unsplit unit project.
    if (normalized.includes('/test/unit/') || normalized.endsWith('.d.ts')) shared.push(file)
  }
}
// Round-robin distribution prevents one project's names from concentrating
// all the large team or browser fixtures. Every configured root is retained.
const projects = Array.from({ length: Math.ceil(tests.length / TESTS_PER_PROJECT) }, () => [
  ...shared,
])
for (const [index, file] of tests.entries()) projects[index % projects.length].push(file)
projects.unshift(support)
// Keep configs below the repository so inherited ambient types resolve through
// its node_modules, exactly as they do for the original unit tsconfig.
const temp = path.join(ROOT, 'temp')
mkdirSync(temp, { recursive: true })
const folder = mkdtempSync(path.join(temp, 'muse-unit-types-'))
try {
  console.log(
    `Unit types: ${config.fileNames.length} configured files, ${projects.length} sequential projects`,
  )
  for (const [index, files] of projects.entries()) {
    const project = path.join(folder, `${index}.json`)
    writeFileSync(project, JSON.stringify({ extends: CONFIG, include: [], files }))
    const result = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit'], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1
      break
    }
  }
} finally {
  rmSync(folder, { recursive: true, force: true })
}
