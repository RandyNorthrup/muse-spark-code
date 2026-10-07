// Node English fallback regions, generated from the one canonical table.
// Browser and integration builds keep en.ts unchanged. Accessors retain the
// complete enumerable shape, while an English Node consumer loads only the
// regions whose values it reads. Serializing a full table reads every region.
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { brotliCompressSync, deflateSync, constants as zlibConstants } from 'node:zlib'
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

// Native DEFLATE keeps browser fallback data lossless without an inflater.
function packedBrowserTable(table, level) {
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^'
  const compressed = deflateSync(
    JSON.stringify([Object.keys(table).join('|'), Object.values(table)]),
    { level },
  )
  let packed = ''
  for (let offset = 0; offset < compressed.length; offset += 4) {
    let word = 0
    for (let byte = 0; byte < 4; byte++) word = word * 256 + (compressed[offset + byte] ?? 0)
    let digits = ''
    for (let digit = 0; digit < 5; digit++) {
      digits = alphabet[word % 85] + digits
      word = Math.floor(word / 85)
    }
    packed += digits
  }
  return `const alphabet=${JSON.stringify(alphabet)},packed=${JSON.stringify(packed)};
const bytes=new Uint8Array(${compressed.length});
for(let offset=0;offset<packed.length;offset+=5){let word=0;for(let digit=0;digit<5;digit++)word=word*85+alphabet.indexOf(packed[offset+digit]);for(let byte=3;byte>=0;byte--){bytes[offset/5*4+byte]=word%256;word=Math.floor(word/256)}}
const [keys,values]=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).json();
export const EN=Object.fromEntries(keys.split('|').map((key,index)=>[key,values[index]]));`
}

// The five reference-card labels belong to chat; all other help text is lazy.
const deferredKey = (key) =>
  key === 'accounts' ||
  key === 'developer' ||
  UI_TEXT_REGIONS[0].keys.test(key) ||
  (key.startsWith('reference') && !/^reference(?:Reply|Question|Comment|Remove|Title)$/.test(key))

// Non-strict installed-table validation needs exactly keys, forms and slots.
// These templates are validation data, never fallback text shown to a user.
function validationTemplate(value) {
  return typeof value === 'string'
    ? value
        .matchAll(/\{\w+\}/g)
        .map(([slot]) => slot)
        .toArray()
        .join('')
    : Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, validationTemplate(entry)]),
      )
}

function browserEnglish(isDeferred) {
  return {
    name: isDeferred ? 'deferred-browser-english' : 'compact-browser-english',
    setup(build) {
      let table
      const readTable = () => (table ??= loadL10n(process.cwd()))
      if (isDeferred) {
        build.onResolve({ filter: /^browser-english-deferred$/ }, () => ({
          path: 'table',
          namespace: 'browser-english-deferred',
        }))
        build.onLoad({ filter: /.*/, namespace: 'browser-english-deferred' }, async () => {
          const { EN, L10N_BROWSER_COMPRESSION_LEVEL } = await readTable()
          return {
            contents: packedBrowserTable(
              Object.fromEntries(Object.entries(EN).filter(([key]) => deferredKey(key))),
              L10N_BROWSER_COMPRESSION_LEVEL,
            ),
            loader: 'js',
            watchFiles: [TABLE, 'src/shared/constants.ts'],
          }
        })
        build.onResolve({ filter: /(?:^|\/)l10n\/en$/ }, (args) =>
          args.importer.replaceAll('\\', '/').endsWith('/src/webview/installTable.ts')
            ? { path: 'table', namespace: 'browser-english-validation' }
            : undefined,
        )
        build.onLoad({ filter: /.*/, namespace: 'browser-english-validation' }, async () => {
          const { EN, L10N_BROWSER_COMPRESSION_LEVEL } = await readTable()
          const templates = Object.fromEntries(
            Object.entries(EN)
              .filter(([key]) => deferredKey(key))
              .map(([key, value]) => [key, validationTemplate(value)]),
          )
          return {
            contents: `import { EN as fallback } from './en'; ${packedBrowserTable(templates, L10N_BROWSER_COMPRESSION_LEVEL).replace('export const EN=', 'const templates=')} export const EN=Object.defineProperties({},Object.getOwnPropertyDescriptors(fallback)); Object.defineProperties(EN,Object.getOwnPropertyDescriptors(templates));`,
            loader: 'js',
            resolveDir: path.resolve('src/shared/l10n'),
            watchFiles: [TABLE],
          }
        })
      }
      build.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, async (args) => {
        if (path.resolve(args.path) !== path.resolve(TABLE)) return
        const { EN, L10N_BROWSER_COMPRESSION_LEVEL } = await readTable()
        const core = isDeferred
          ? Object.fromEntries(Object.entries(EN).filter(([key]) => !deferredKey(key)))
          : EN
        let contents = packedBrowserTable(core, L10N_BROWSER_COMPRESSION_LEVEL)
        if (isDeferred) {
          const keys = Object.keys(EN).filter((key) => deferredKey(key))
          contents += `
let deferred, pending;
Object.defineProperty(EN,'loadDeferred',{value:async()=>{
  if(!pending)pending=import('browser-english-deferred').then(module=>{deferred=module.EN},error=>{pending=undefined;throw error});
  await pending;
}});
for(const key of ${JSON.stringify(keys)})Object.defineProperty(EN,key,{enumerable:true,configurable:true,get(){if(!deferred)throw new Error('Deferred English has not loaded');return deferred[key]}});`
        }
        return { contents, loader: 'js', watchFiles: [args.path, 'src/shared/constants.ts'] }
      })
    },
  }
}

/** Complete inline fallback for independent pages and integration fixtures. */
export const compactBrowserEnglish = browserEnglish(false)
/** Chat loads account/developer/help fallback only at its first lazy surface. */
export const deferredBrowserEnglish = browserEnglish(true)
