// Node English fallback regions, generated from the one canonical table.
// Integration builds keep en.ts unchanged. Accessors retain the
// complete enumerable shape, while an English Node consumer loads only the
// regions whose values it reads. Serializing a full table reads every region.
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { brotliCompressSync, deflateSync, constants as zlibConstants } from 'node:zlib'
import ts from 'typescript'
import { loadL10n } from './l10nSource.mjs'
import { browserStartupSources } from './browserKeybindings.mjs'

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

/** Encode browser values with the same lossless native codec in every build. */
function inlineBrowserTable(table, compressionLevel, readers) {
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^'
  const compressed = deflateSync(
    JSON.stringify([Object.keys(table).join('|'), Object.values(table), readers]),
    { level: compressionLevel },
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
const [names,values,readers]=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).json();
const keys=names.split('|');
${
  readers === undefined
    ? 'export const EN=Object.fromEntries(keys.map((key,index)=>[key,values[index]]));'
    : `export const EN_SHAPE=Object.fromEntries(keys.map((key,index)=>[key,values[index]]));
export const EN=Object.fromEntries(keys.flatMap((key,index)=>readers[index]==='1'?[[key,EN_SHAPE[key]]]:[]));
const lazyValues={};
export function installSurfaceEnglish(table){Object.assign(lazyValues,table)}
keys.forEach((key,index)=>{if(readers[index]==='2')Object.defineProperty(EN,key,{enumerable:true,configurable:true,get(){if(!Object.hasOwn(lazyValues,key))throw new Error('English surface is not loaded: '+key);return lazyValues[key]}})});`
}`
}

/** The standalone browser fallback retains the entire canonical table. */
export const compactBrowserEnglish = {
  name: 'compact-browser-english',
  setup(build) {
    build.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== path.resolve(TABLE)) return
      const { EN, L10N_BROWSER_COMPRESSION_LEVEL } = await loadL10n(process.cwd())
      // DIET1: the complete fallback stays inline. Native DEFLATE decoding
      // completes before dependent ESM modules run (Chrome 128 and later).
      return {
        contents: inlineBrowserTable(EN, L10N_BROWSER_COMPRESSION_LEVEL),
        loader: 'js',
        watchFiles: [args.path, 'src/shared/constants.ts'],
      }
    })
  },
}

/** Browser table validation needs canonical slots and structure, never host prose. */
function browserTableContract(value) {
  return typeof value === 'string'
    ? [...new Set(value.match(/\{\w+\}/g))].join('')
    : Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, browserTableContract(nested)]),
      )
}

/** Collect every literal text reader in the shipped static and dynamic source graph. */
export function browserTextKeys(entries, english, eagerSources = new Set()) {
  const seen = new Set()
  const keys = new Set()
  const eagerKeys = new Set()
  const visit = (file) => {
    file = path.resolve(file)
    if (seen.has(file) || file === path.resolve(TABLE)) return
    seen.add(file)
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const resolve = (specifier) => {
      if (!specifier.startsWith('.')) return
      const source = path.resolve(path.dirname(file), specifier)
      const resolved = [source, `${source}.ts`, `${source}.tsx`, `${source}/index.ts`].find(
        (candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate),
      )
      if (resolved !== undefined) visit(resolved)
    }
    const walk = (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'UI_TEXT'
      ) {
        keys.add(node.name.text)
        if (eagerSources.has(file)) eagerKeys.add(node.name.text)
      }
      if (ts.isStringLiteral(node) && Object.hasOwn(english, node.text)) {
        keys.add(node.text)
        if (eagerSources.has(file)) eagerKeys.add(node.text)
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'UI_TEXT'
      ) {
        if (ts.isStringLiteral(node.argumentExpression)) keys.add(node.argumentExpression.text)
        else if (
          file !== path.resolve('src/webview/components/ReferencePage.tsx') ||
          node.argumentExpression.getText(tree) !== 'entry.usageKey'
        )
          throw new Error(`Unregistered dynamic browser text reader: ${file}`)
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0])
      )
        resolve(node.arguments[0].text)
      ts.forEachChild(node, walk)
    }
    walk(tree)
    for (const node of tree.statements) {
      if (
        ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
          (ts.isExportDeclaration(node) && !node.isTypeOnly)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        resolve(node.moduleSpecifier.text)
      }
    }
  }
  for (const entry of entries) visit(entry)
  // Help resolves typed ui/usageKey references from the generated model at runtime.
  const reference = JSON.parse(
    readFileSync('src/shared/reference/reference.generated.json', 'utf8'),
  )
  const collect = (value) => {
    if (typeof value === 'string' && Object.hasOwn(english, value)) keys.add(value)
    else if (value !== null && typeof value === 'object') {
      if (Object.hasOwn(value, 'cli')) keys.add('referenceCliOptions')
      if (Object.hasOwn(value, 'tip')) keys.add('paletteTips')
      for (const nested of Object.values(value)) collect(nested)
    }
  }
  collect(reference)
  for (const key of keys)
    if (!Object.hasOwn(english, key)) throw new Error(`Unknown browser text: ${key}`)
  return { keys, files: [...seen], eagerKeys }
}

/** Production browser readers retain their English; complete translation checks retain their contract. */
export const compactBrowserUiText = {
  name: 'compact-browser-ui-text',
  setup(build) {
    let data
    build.onStart(async () => {
      const { EN, L10N_BROWSER_COMPRESSION_LEVEL } = await loadL10n(process.cwd())
      const entries = Object.values(build.initialOptions.entryPoints)
      const roots = entries.filter((entry) => {
        const normal = entry.replaceAll('\\', '/')
        return !normal.endsWith('/ReferencePage.tsx') && !normal.includes('/temp/')
      })
      const eagerSources = browserStartupSources(roots).files
      const { keys, files, eagerKeys } = browserTextKeys(entries, EN, eagerSources)
      const deferredKeys = [...keys].filter((key) => !eagerKeys.has(key))
      const readers = new Set([...keys].filter((key) => !deferredKeys.includes(key)))
      const contract = Object.fromEntries(
        Object.entries(EN).map(([key, value]) => [
          key,
          readers.has(key) ? value : browserTableContract(value),
        ]),
      )
      const lanes = Object.keys(EN)
        .map((key) => {
          if (readers.has(key)) return '1'
          return deferredKeys.includes(key) ? '2' : '0'
        })
        .join('')
      data = {
        EN,
        keys,
        files,
        lanes,
        deferredKeys,
        contract,
        level: L10N_BROWSER_COMPRESSION_LEVEL,
      }
    })
    build.onResolve({ filter: /^browser-table-contract$/ }, () => ({
      path: 'browser-table-contract',
      namespace: 'browser-table-contract',
    }))
    for (const namespace of ['browser-table-contract', 'browser-surface-english']) {
      build.onResolve({ filter: /.*/, namespace }, (args) => {
        if (args.path === path.resolve(TABLE).replaceAll('\\', '/'))
          return { path: path.resolve(TABLE), namespace: 'file' }
      })
    }
    build.onLoad({ filter: /.*/, namespace: 'browser-table-contract' }, () => ({
      contents:
        "export { EN_SHAPE as EN } from '" + path.resolve(TABLE).replaceAll('\\', '/') + "'",
      loader: 'js',
    }))
    build.onLoad({ filter: /[/\\]installTable\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, 'utf8').replace(
        "import { EN, type UiText } from '../shared/l10n/en'",
        "import { EN } from 'browser-table-contract'; import type { UiText } from '../shared/l10n/en'",
      ),
      loader: 'ts',
      resolveDir: path.dirname(args.path),
      watchFiles: [args.path],
    }))
    build.onResolve({ filter: /^browser-surface-english$/ }, () => ({
      path: 'browser-surface-english',
      namespace: 'browser-surface-english',
    }))
    build.onLoad({ filter: /.*/, namespace: 'browser-surface-english' }, () => ({
      contents: `import { installSurfaceEnglish } from '${path.resolve(TABLE).replaceAll('\\', '/')}';
${inlineBrowserTable(Object.fromEntries(data.deferredKeys.map((key) => [key, data.EN[key]])), data.level)}
installSurfaceEnglish(EN);`,
      loader: 'js',
    }))
    build.onLoad({ filter: /[/\\]webview[/\\].*\.tsx$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8')
      if (!source.includes('lazy')) return
      const tree = ts.createSourceFile(
        args.path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const edits = []
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'lazy'
        ) {
          if (node.arguments.length !== 1 || node.arguments[0] === undefined)
            throw new Error(`Unsupported lazy English loader: ${args.path}`)
          const argument = node.arguments[0]
          edits.push({
            start: argument.getStart(tree),
            end: argument.end,
            source: `async () => { await import('browser-surface-english'); return await (${argument.getText(tree)})() }`,
          })
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
      if (edits.length === 0) return
      let contents = source
      const ordered = edits.toSorted((left, right) => right.start - left.start)
      for (const edit of ordered)
        contents = contents.slice(0, edit.start) + edit.source + contents.slice(edit.end)
      return {
        contents,
        loader: 'tsx',
        resolveDir: path.dirname(args.path),
        watchFiles: [args.path],
      }
    })
    build.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, (args) => {
      if (path.resolve(args.path) !== path.resolve(TABLE)) return
      return {
        contents: inlineBrowserTable(data.contract, data.level, data.lanes),
        loader: 'js',
        watchFiles: [args.path, ...data.files, 'src/shared/reference/reference.generated.json'],
      }
    })
  },
}

/** Pack the complete reference only in Node production bundles. */
export function compressedReference(isProduction) {
  return {
    name: 'compressed-node-reference',
    setup(build) {
      if (!isProduction) return
      build.onLoad({ filter: /[/\\]reference\.generated\.ts$/ }, async (args) => {
        const source = readFileSync(args.path, 'utf8')
        const tree = ts.createSourceFile(args.path, source, ts.ScriptTarget.Latest, true)
        const factory = tree.statements.find(
          (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'referenceModel',
        )
        if (factory === undefined) throw new Error('Missing generated reference factory')
        const { L10N_COMPRESSION_QUALITY } = await loadL10n(process.cwd())
        const modelPath = path.join(path.dirname(args.path), 'reference.generated.json')
        const packed = brotliCompressSync(readFileSync(modelPath), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: L10N_COMPRESSION_QUALITY },
        }).toString('base64')
        const factorySource = `export function referenceModel() { return parseReferenceModel(JSON.parse(brotliDecompressSync(Buffer.from(${JSON.stringify(packed)}, 'base64')).toString('utf8'))) }`
        return {
          contents:
            "import { Buffer } from 'node:buffer'; import { brotliDecompressSync } from 'node:zlib';\n" +
            source.slice(0, factory.getStart(tree)) +
            factorySource +
            source.slice(factory.end),
          loader: 'ts',
          resolveDir: path.dirname(args.path),
          watchFiles: [args.path, modelPath],
        }
      })
    },
  }
}
