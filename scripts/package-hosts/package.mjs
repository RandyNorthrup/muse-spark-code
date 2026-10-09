import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEnvironment, hostManifest, inside, MHP_VERSION } from './manifest.mjs'
import * as z from 'zod/mini'

// Record all injected bytes, including the entire deferred portable graph.
// Refuse special files and symlinks before copying or starting a native child.
function inventory(directory) {
  const hashes = {}
  function visit(folder) {
    const names = readdirSync(folder).toSorted((left, right) => {
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    for (const name of names) {
      const file = path.join(folder, name)
      const info = lstatSync(file)
      if (info.isSymbolicLink()) throw new Error('MHP_HOST_RUNTIME_SYMLINK')
      if (info.isDirectory()) visit(file)
      else {
        if (!info.isFile()) throw new Error('MHP_HOST_RUNTIME_INCOMPLETE')
        const relative = path.relative(directory, file).split(path.sep).join('/')
        hashes[relative] = createHash('sha256').update(readFileSync(file)).digest('hex')
      }
    }
  }
  visit(directory)
  return hashes
}

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
  const product = z
    .object({ version: z.string(), devDependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')))
  const agent = z
    .object({ version: z.string(), dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(inside(source, 'package.json'), 'utf8')))
  if (agent.version !== product.version) throw new Error('MHP_HOST_RUNTIME_VERSION')
  const keyring = product.devDependencies['@napi-rs/keyring']
  if (keyring === undefined || agent.dependencies['@napi-rs/keyring'] !== keyring)
    throw new Error('MHP_HOST_RUNTIME_DEPENDENCY')
  for (const name of [
    'runtimePanel.js',
    'runtimePanelPorts.js',
    'conversation.js',
    'uiText.js',
    'runtimeContext.js',
    'runtimeEngines.js',
    'runtimeBackendServices.js',
    'runtimePresentation.js',
    'hostProtocol.js',
    'sessionBoard.js',
    'checkpointStore.js',
    'planMarkdown.js',
    'judge.js',
    'browserCheck.js',
    'browserRuntime.js',
    'whatsNew.json',
  ])
    if (!statSync(inside(source, `dist/${name}`)).isFile())
      throw new Error('MHP_HOST_RUNTIME_INCOMPLETE')
  const runtimeSha256 = inventory(source)
  const portableRoot = 'dist/webview/portable/'
  for (const name of ['modules.json', 'loader.js', 'main.css', 'whatsNew.css', 'presentation.css'])
    if (runtimeSha256[`${portableRoot}${name}`] === undefined)
      throw new Error('MHP_HOST_PORTABLE_INCOMPLETE')
  const portable = z
    .object({
      modules: z.array(
        z.object({
          path: z.string().check(z.regex(/^\/assets\/portable\/(?:chunks\/)?[\w.-]+\.js$/u)),
          bytes: z.number().check(z.int(), z.gte(0)),
          sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(inside(source, `${portableRoot}modules.json`), 'utf8')))
  const modules = portable.modules.map(
    (module) => `${portableRoot}${module.path.slice('/assets/portable/'.length)}`,
  )
  if (
    new Set(modules).size !== modules.length ||
    !modules.includes(`${portableRoot}main.js`) ||
    !modules.includes(`${portableRoot}presentation.js`)
  )
    throw new Error('MHP_HOST_PORTABLE_INVENTORY')
  for (const [index, module] of portable.modules.entries()) {
    const name = modules[index]
    if (
      runtimeSha256[name] !== module.sha256 ||
      statSync(inside(source, name)).size !== module.bytes
    )
      throw new Error('MHP_HOST_PORTABLE_INTEGRITY')
  }
  if (
    Object.keys(runtimeSha256).some(
      (name) =>
        name.startsWith(portableRoot) &&
        name.endsWith('.js') &&
        name !== `${portableRoot}loader.js` &&
        !modules.includes(name),
    )
  )
    throw new Error('MHP_HOST_PORTABLE_UNLISTED')
  cpSync(source, runtime, { recursive: true, dereference: true })
  const env = {
    ...buildEnvironment(process.env),
    MUSE_HOST_RUNTIME: runtime,
    MUSE_MHP_VERSION: MHP_VERSION,
  }
  for (const task of manifest.build)
    run(task.command, task.args, { cwd: directory, env, stdio: 'inherit', timeout: 1_200_000 })
  if (JSON.stringify(inventory(runtime)) !== JSON.stringify(runtimeSha256))
    throw new Error('MHP_HOST_RUNTIME_CHANGED')
  const version = product.version
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
  const receipt = {
    host,
    outcome: 'packaged',
    mhp: MHP_VERSION,
    version,
    tree,
    sha256,
    runtimeSha256,
  }
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
