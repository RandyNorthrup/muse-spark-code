// Node English fallback regions, generated from the one canonical table.
// Browser and integration builds keep en.ts unchanged. Accessors retain the
// complete enumerable shape, while an English Node consumer loads only the
// regions whose values it reads. Serializing a full table reads every region.
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import ts from 'typescript'
import { loadL10n } from './l10nSource.mjs'

const TABLE = 'src/shared/l10n/en.ts'
export const UI_TEXT_REGIONS = [
  {
    name: 'runtime',
    output: 'dist/uiTextRuntime.js',
    keys: /^(?:acp|exec|scanSecrets|reportUsage$)/,
  },
  {
    name: 'hooks',
    output: 'dist/uiTextHooks.js',
    keys: /^(?:hook|paid\w*Hook|usagePaidHook|setupHook|manualHook|plugin|extensionHook|foreignHook|agentImport)/,
  },
  {
    name: 'surfaces',
    output: 'dist/uiTextSurfaces.js',
    keys: /^(?:tab|paid\w*Tab|usagePaidTab|report(?!Usage$)|whatsNew)/,
  },
]

/** The canonical object, parsed rather than searched through strings/comments. */
export function uiTextProperties() {
  const source = readFileSync(TABLE, 'utf8')
  const tree = ts.createSourceFile(TABLE, source, ts.ScriptTarget.Latest, true)
  const declaration = tree.statements
    .filter((statement) => ts.isVariableStatement(statement))
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => entry.name.getText(tree) === 'EN')
  if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
    throw new Error(`${TABLE} must export the canonical EN object`)
  }
  return declaration.initializer.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Error(`${TABLE} contains an unsupported English property`)
    }
    const key = property.name.text
    const regions = UI_TEXT_REGIONS.filter((region) => region.keys.test(key))
    if (regions.length > 1) throw new Error(`${TABLE}.${key} belongs to several regions`)
    return { key, source: property.getText(tree), region: regions[0]?.name }
  })
}

/** @returns {import('esbuild').Plugin} */
export function regionalUiText(name) {
  return {
    name: `regional-ui-text-${name ?? 'core'}`,
    setup(build) {
      build.onResolve({ filter: /^\.\/uiText\w+\.js$/ }, (args) =>
        UI_TEXT_REGIONS.some((region) => `./${path.basename(region.output)}` === args.path)
          ? { path: args.path, external: true }
          : undefined,
      )
      build.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, (args) => {
        if (path.resolve(args.path) !== path.resolve(TABLE)) return
        const properties = uiTextProperties()
        const kept = properties.filter((property) => property.region === name)
        const base = `import { forms } from './forms'; export const EN = {${kept.map((property) => property.source).join(',')}};`
        const accessors =
          name === undefined
            ? UI_TEXT_REGIONS.map((region) => {
                const keys = properties
                  .filter((property) => property.region === region.name)
                  .map((property) => property.key)
                if (keys.length === 0) throw new Error(`Empty English region ${region.name}`)
                return `for (const key of ${JSON.stringify(keys)}) Object.defineProperty(EN, key, {enumerable: true, configurable: true, get() { return require('./${path.basename(region.output)}').EN[key] }});`
              }).join('\n')
            : ''
        return {
          contents: base + accessors,
          loader: 'ts',
          resolveDir: path.dirname(args.path),
          watchFiles: [args.path],
        }
      })
    },
  }
}

// Use the same production codec for disk builds and private in-memory fixtures.
/** @returns {import('esbuild').Plugin} */
export function compressedEnglish(file, isProduction, compressionQuality) {
  return {
    name: 'compressed-english',
    setup(build) {
      build.onEnd((result) => {
        if (!isProduction || result.errors.length > 0) return
        const outputFile = result.outputFiles?.find(
          (output) => path.resolve(output.path) === path.resolve(file),
        )
        const module = { exports: {} }
        runInNewContext(outputFile?.text ?? readFileSync(file, 'utf8'), {
          module,
          exports: module.exports,
        })
        // Data descriptors preserve the regions' first-value loading boundary.
        const data = Object.fromEntries(
          Object.entries(Object.getOwnPropertyDescriptors(Reflect.get(module.exports, 'EN')))
            .filter(([, property]) => Object.hasOwn(property, 'value'))
            .map(([key, property]) => [key, property.value]),
        )
        const packed = brotliCompressSync(JSON.stringify(data), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: compressionQuality },
        }).toString('base64')
        const getters =
          path.basename(file) === 'uiText.js'
            ? UI_TEXT_REGIONS.map((region) => {
                const keys = uiTextProperties()
                  .filter((property) => property.region === region.name)
                  .map((property) => property.key)
                return `for(const key of ${JSON.stringify(keys)})Object.defineProperty(exports.EN,key,{enumerable:true,configurable:true,get(){return require('./${path.basename(region.output)}').EN[key]}});`
              }).join('\n')
            : ''
        const code = `exports.EN=JSON.parse(require("node:zlib").brotliDecompressSync(Buffer.from("${packed}","base64")).toString("utf8"));\n${getters}\n`
        if (outputFile === undefined) writeFileSync(file, code)
        else outputFile.contents = Buffer.from(code)
        const output = result.metafile?.outputs[file]
        if (output === undefined) return
        output.bytes = Buffer.byteLength(code)
        output.imports.push({ path: 'node:zlib', kind: 'require-call', external: true })
      })
    },
  }
}

/** The browser still carries all English; repeated fragments share a dictionary. */
export const compactBrowserEnglish = {
  name: 'compact-browser-english',
  setup(build) {
    build.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== path.resolve(TABLE)) return
      const { EN, compactEnglishSource } = await loadL10n(process.cwd())
      return {
        contents: compactEnglishSource(EN),
        loader: 'js',
        watchFiles: [args.path, 'src/shared/l10n/compactEnglish.ts', 'src/shared/constants.ts'],
      }
    })
  },
}
