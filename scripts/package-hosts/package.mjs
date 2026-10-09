import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEnvironment, hostManifest, inside } from './manifest.mjs'

/** Native commands own archive layout; the injected runtime is identical for all hosts. */
export function packageHost(root, host, run = execFileSync) {
  const found = hostManifest(root, host)
  if ('outcome' in found) return found
  const { directory, manifest } = found
  const stage = path.join(root, 'dist', 'hosts', host)
  const runtime = path.join(stage, 'runtime')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  // Consume the production npm staging tree, including native keyring dependencies.
  // Never install, copy from a shared node_modules, or manufacture a runtime here.
  const source = inside(root, 'dist/acp-package')
  for (const name of ['dist/acp.js', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'])
    if (!statSync(inside(source, name)).isFile()) throw new Error('MHP_HOST_RUNTIME_INCOMPLETE')
  cpSync(source, runtime, { recursive: true, dereference: true })
  const env = {
    ...buildEnvironment(process.env),
    MUSE_HOST_RUNTIME: runtime,
    MUSE_MHP_VERSION: 'mhp/1.1.0',
  }
  for (const task of manifest.build)
    run(task.command, task.args, { cwd: directory, env, stdio: 'inherit', timeout: 1_200_000 })
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const sha256 = {}
  for (const name of manifest.artifacts) {
    const artifact = inside(directory, name)
    if (!statSync(artifact).isFile() || statSync(artifact).size === 0)
      throw new Error('MHP_HOST_EMPTY_ARTIFACT')
    const output = `muse-spark-code-${host}-${version}-${path.basename(name)}`
    if (Object.hasOwn(sha256, output)) throw new Error('MHP_HOST_DUPLICATE_ARTIFACT')
    copyFileSync(artifact, path.join(stage, output))
    sha256[output] = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  }
  const tree = run('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: root,
    encoding: 'utf8',
    env: buildEnvironment(process.env),
  }).trim()
  const receipt = { host, outcome: 'packaged', mhp: '1.x', version, tree, sha256 }
  writeFileSync(path.join(stage, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = packageHost(process.cwd(), process.argv[2])
    console.log(JSON.stringify(result))
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${result.outcome}\n`)
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n${result.host}: ${result.outcome}${result.reason ? ` — ${result.reason}` : ''}\n`,
      )
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'MHP_HOST_PACKAGE_FAILED')
    process.exitCode = 1
  }
}
