// Independent node browser entry. C/M104 adds this to the release build;
// ordinary extension/ACP/main-webview budgets remain unchanged.
import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { uiTextProperties } from '../../scripts/lib/uiTextRegions.mjs'

// This independent surface keeps its own inline English fallback. Its factory
// projects the installed table onto these keys before the existing table check;
// the ordinary chat/integration fallback and its validation are untouched.
// backendMuseCode/backendModelApi ride along: the workspace imports `fill`
// from text.ts, whose tree-shaken backendLabel touches them, and the
// whole-file check below requires every key an input reaches.
const properties = uiTextProperties().filter((item) =>
  /^(?:node|git|shareShowMore$|backendMuseCode$|backendModelApi$)/u.test(item.key),
)
const keys = new Set(properties.map((item) => item.key))
const nodeEnglish = {
  name: 'node-inline-english',
  setup(bundle) {
    bundle.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, (args) => ({
      contents: `import { forms } from './forms'; export const EN = {${properties.map((item) => item.source).join(',')}}`,
      loader: 'ts',
      resolveDir: path.dirname(args.path),
      watchFiles: [args.path],
    }))
  },
}

function sizeKiB(files) {
  return files.reduce((sum, file) => sum + statSync(file).size, 0) / 1024
}

function packageLicence(input) {
  let folder = path.dirname(path.resolve(input))
  while (folder !== path.dirname(folder)) {
    const manifest = path.join(folder, 'package.json')
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
        const licence = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
          .map((name) => path.join(folder, name))
          .find(existsSync)
        if (licence === undefined) throw new Error(`missing node package licence: ${pkg.name}`)
        return [`${pkg.name}@${pkg.version}`, readFileSync(licence, 'utf8')]
      }
    }
    folder = path.dirname(folder)
  }
  throw new Error(`missing package manifest: ${input}`)
}

export async function buildNodeWorkspace(output = 'dist/webview/node', dependencyRoot) {
  // Resolve the approved pins from the requested install, rather than allowing
  // an unrelated shared install to override the isolated dependency graph.
  const require = createRequire(
    dependencyRoot === undefined
      ? import.meta.url
      : path.resolve(dependencyRoot, '..', 'package.json'),
  )
  // Both exact pins expose ESM beside their CommonJS resolver entry. Select
  // ESM so the minimal setup tree-shakes and editor/merge share their modules.
  const codeMirror = require.resolve('codemirror').replace(/\.cjs$/u, '.js')
  const merge = require.resolve('@codemirror/merge').replace(/\.cjs$/u, '.js')
  const constants = await build({
    stdin: {
      contents:
        "export { NODE_WORKSPACE_BUDGET_KIB, NODE_EDITOR_BUDGET_KIB } from '../../src/shared/constants'",
      resolveDir: path.resolve('test/harness'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const { NODE_WORKSPACE_BUDGET_KIB, NODE_EDITOR_BUDGET_KIB } = await import(
    `data:text/javascript;base64,${Buffer.from(constants.outputFiles[0].contents).toString('base64')}`
  )
  rmSync(output, { recursive: true, force: true })
  const result = await build({
    entryPoints: ['src/webview/node/files/main.tsx'],
    outdir: output,
    entryNames: 'files/main',
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    minify: true,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    splitting: true,
    target: 'chrome128',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [nodeEnglish],
    alias: { codemirror: codeMirror, '@codemirror/merge': merge },
    ...(dependencyRoot !== undefined && { nodePaths: [dependencyRoot] }),
  })
  mkdirSync('dist/meta-node', { recursive: true })
  writeFileSync('dist/meta-node/workspace.json', JSON.stringify(result.metafile))
  const outputs = result.metafile.outputs
  for (const file of Object.keys(result.metafile.inputs)) {
    if (!file.replaceAll('\\', '/').startsWith('src/')) continue
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const visitText = (item) => {
      if (
        ts.isPropertyAccessExpression(item) &&
        ts.isIdentifier(item.expression) &&
        item.expression.text === 'UI_TEXT' &&
        !keys.has(item.name.text)
      )
        throw new Error(`node English fallback misses ${file}: ${item.name.text}`)
      ts.forEachChild(item, visitText)
    }
    visitText(source)
  }
  const main = Object.entries(outputs).find(
    ([, item]) => item.entryPoint?.replaceAll('\\', '/') === 'src/webview/node/files/main.tsx',
  )?.[0]
  if (main === undefined) throw new Error('missing node workspace entry')
  const staticFiles = new Set()
  const visit = (file) => {
    if (staticFiles.has(file)) return
    staticFiles.add(file)
    const imports = outputs[file]?.imports ?? []
    for (const item of imports)
      if (item.kind === 'import-statement' && !item.external) visit(item.path)
  }
  visit(main)
  const startup = sizeKiB([...staticFiles].filter((file) => file.endsWith('.js')))
  const editor = sizeKiB(
    Object.keys(outputs).filter((file) => file.endsWith('.js') && !staticFiles.has(file)),
  )
  console.log(
    `node workspace: ${startup.toFixed(1)}/${String(NODE_WORKSPACE_BUDGET_KIB)} KiB; editor: ${editor.toFixed(1)}/${String(NODE_EDITOR_BUDGET_KIB)} KiB`,
  )
  if (startup > NODE_WORKSPACE_BUDGET_KIB || editor > NODE_EDITOR_BUDGET_KIB)
    throw new Error('node browser budget exceeded')
  const packages = new Map()
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.replaceAll('\\', '/').includes('node_modules/')) continue
    const [name, licence] = packageLicence(input)
    packages.set(name, licence)
  }
  writeFileSync(
    path.join(output, 'THIRD_PARTY_NOTICES.txt'),
    [...packages]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, licence]) => `${name}\n\n${licence}`)
      .join('\n\n'),
  )
  return result.metafile
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/test/harness/build-node.mjs')) {
  const temporary = path.resolve('temp/u1-deps/node_modules')
  await buildNodeWorkspace(undefined, existsSync(temporary) ? temporary : undefined)
  const meta = JSON.parse(readFileSync('dist/meta-node/workspace.json', 'utf8'))
  if (
    Object.keys(meta.inputs).every(
      (file) => !file.replaceAll('\\', '/').includes('/@codemirror/merge/'),
    )
  )
    throw new Error('missing real merge implementation')
}
