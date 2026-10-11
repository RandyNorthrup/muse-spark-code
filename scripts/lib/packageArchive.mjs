import { tableLayout, packTable } from './packedL10n.mjs'
// Independent solid archives of canonical tables and exact lazy CommonJS bytes.
// Source/build files stay intact; English keeps its independent inline fallback.
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { promisify } from 'node:util'
import { brotliCompress, brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import ts from 'typescript'
import { loadL10n } from './l10nSource.mjs'
import { UI_TEXT_REGIONS } from './uiTextRegions.mjs'

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// TRAIN15E: activation uses the same verified archive loader as lazy entries.
// The ACP preflight stays directly executable for its cold-start deadline.
const EAGER = new Set([
  'acp.js',
  'headless.js',
  'providerPolicy.js',
  'recorder.js',
  'validation.js',
  'wire.js',
  'uiTextRuntime.js',
])
const CODE_ARCHIVE = 'runtime.bundles.json.br'
const digest = (text) => createHash('sha256').update(text).digest('hex')
const compressBrotli = promisify(brotliCompress)

export async function packRuntimeArchive(root, stage, files, tables) {
  const orderedTables = tables.toSorted(([left], [right]) => left.localeCompare(right, 'en'))
  const {
    EN,
    L10N_TABLE_MAX_BYTES,
    L10N_COMPRESSION_QUALITY,
    L10N_TABLE_ARCHIVE_FILE,
    USAGE_TABLE_ARCHIVE_FILE,
    TABLE_LOCALES,
  } = await loadL10n(SOURCE_ROOT)
  const maxOutputLength = L10N_TABLE_MAX_BYTES * TABLE_LOCALES.length
  const keys = Object.keys(orderedTables[0]?.[1] ?? {})
  if (
    orderedTables.some(([, table]) => JSON.stringify(Object.keys(table)) !== JSON.stringify(keys))
  )
    throw new Error('Translation tables have inconsistent key order')
  const layout = tableLayout(EN)
  const archive = {
    version: 1,
    format: 1,
    locales: orderedTables.map(([locale]) => locale),
    values: orderedTables.map(([, table]) => packTable(layout, table).values),
    english: {},
  }
  const codeArchive = { version: 1, bundles: {} }
  // The CommonJS compiler preserves relative requires, exports and stack paths.
  // Every executable member is checked against its original build-time digest.
  const orderedFiles = files.toSorted((left, right) => left.localeCompare(right, 'en'))
  for (const file of orderedFiles) {
    if (
      !/^dist\/[^/]+\.js$/.test(file) ||
      EAGER.has(path.basename(file)) ||
      path.basename(file).startsWith('uiText')
    )
      continue
    const source = readFileSync(path.join(root, file), 'utf8')
    // Refuse an oversized member before parsing its executable source or staging it.
    // The complete serialized archive is still checked below for aggregate overhead.
    if (Buffer.byteLength(source) > maxOutputLength)
      throw new Error('Runtime archive exceeds decoded bound')
    // Native import discovers CommonJS names before _compile runs. Retain the
    // build's inert export annotation, plus direct exports in plain CJS inputs.
    // Parse statements so text inside strings/comments cannot declare exports.
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const declarations = tree.statements
      .flatMap((statement) => {
        if (!ts.isExpressionStatement(statement)) return []
        const text = statement.getText(tree)
        if (/^0\s*&&\s*\(module\.exports\s*=\s*\{/.test(text)) return [text]
        const name = /^exports\.([\w$]+)\s*=/.exec(text)?.[1]
        return name === undefined ? [] : [`0&&(exports.${name}=0);`]
      })
      .join('\n')
    codeArchive.bundles[path.basename(file)] = source
    writeFileSync(
      path.join(stage, file),
      `${declarations}\nconst packedRequire=require('node:module').createRequire(__filename);\nmodule._compile((packedRequire('./uiText.js'),packedRequire.cache[packedRequire.resolve('./uiText.js')].readPackedRuntime('bundles',${JSON.stringify(path.basename(file))},'${digest(source)}')),__filename);\n`,
    )
  }
  for (const region of UI_TEXT_REGIONS) {
    const file = path.join(root, region.output)
    const source = readFileSync(file, 'utf8')
    const module = { exports: {} }
    runInNewContext(source, {
      module,
      exports: module.exports,
      require: createRequire(file),
      Buffer,
    })
    const english = JSON.stringify(module.exports.EN)
    if (english === undefined) throw new Error(`Missing English region: ${region.output}`)
    // Preflight reads runtime errors before it needs any archived table.
    if (EAGER.has(path.basename(region.output))) continue
    archive.english[region.name] = english
    writeFileSync(
      path.join(stage, region.output),
      `try{const packedRequire=require('node:module').createRequire(__filename);exports.EN=JSON.parse((packedRequire('./uiText.js'),packedRequire.cache[packedRequire.resolve('./uiText.js')].readPackedRuntime('english','${region.name}','${digest(english)}')));}catch{\n${source}\n}\n`,
    )
  }
  const text = JSON.stringify(archive)
  // Group larger members first for the solid compressor; source bytes and
  // digests remain identical, with a name tie-break for deterministic staging.
  codeArchive.bundles = Object.fromEntries(
    Object.entries(codeArchive.bundles).toSorted(
      ([left, leftSource], [right, rightSource]) =>
        rightSource.length - leftSource.length || left.localeCompare(right, 'en'),
    ),
  )
  const codeText = JSON.stringify(codeArchive)
  if (Object.hasOwn(codeArchive.bundles, 'providerCatalog.js'))
    rmSync(path.join(stage, 'dist/providerCatalog.json'), { force: true })
  if (Buffer.byteLength(text) > maxOutputLength || Buffer.byteLength(codeText) > maxOutputLength)
    throw new Error('Runtime archive exceeds decoded bound')
  const core = path.join(stage, 'dist/uiText.js')
  // Keep the eager fallback smaller even after adding the lazy archive reader.
  // Only the build's generated regional key lists change representation.
  const coreSource = readFileSync(core, 'utf8').replaceAll(
    /for\(const key of (\[[^\n]+\])\)Object\.defineProperty/g,
    (_, list) => {
      const packed = brotliCompressSync(list, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: L10N_COMPRESSION_QUALITY },
      }).toString('base64')
      return `for(const key of JSON.parse(require('node:zlib').brotliDecompressSync(Buffer.from('${packed}','base64')).toString('utf8')))Object.defineProperty`
    },
  )
  writeFileSync(
    core,
    `${coreSource}
module.readPackedRuntime=(()=>{
  const archives={};
  return (kind,name,digest)=>{
    let archive=archives[kind];
    if(!archive){
      const file=kind==='bundles'?'${CODE_ARCHIVE}':'../l10n/${L10N_TABLE_ARCHIVE_FILE}';
      const text=require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(require('node:path').join(__dirname,file)),{maxOutputLength:${maxOutputLength}}).toString('utf8');
      const parsed=JSON.parse(text);
      if(parsed.version!==1)throw new Error('Invalid runtime archive version');
      archive=parsed;
    }
    const members=archive[kind];
    const text=members&&Object.hasOwn(members,name)?members[name]:undefined;
    if(typeof text!=='string'||require('node:crypto').createHash('sha256').update(text).digest('hex')!==digest){delete archives[kind];throw new Error('Invalid runtime archive member');}
    archives[kind]=archive;
    return text;
  };
})();
`,
  )
  const usage = Object.fromEntries(
    TABLE_LOCALES.map((locale) => [
      locale,
      JSON.parse(readFileSync(path.join(root, 'l10n', `usage.${locale}.json`), 'utf8')),
    ]),
  )
  const usageText = JSON.stringify(usage)
  if (Buffer.byteLength(usageText) > maxOutputLength)
    throw new Error('Usage archive exceeds decoded bound')
  // Each bounded archive has its own compressor; Node's zlib pool bounds
  // simultaneous work. Canonical inputs and compression parameters stay exact.
  const members = [
    [path.join(stage, 'l10n', L10N_TABLE_ARCHIVE_FILE), text],
    [path.join(stage, 'dist', CODE_ARCHIVE), codeText],
    [path.join(stage, 'l10n', USAGE_TABLE_ARCHIVE_FILE), usageText],
  ]
  const packed = await Promise.all(
    members.map(([, contents]) =>
      compressBrotli(contents, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: L10N_COMPRESSION_QUALITY },
      }),
    ),
  )
  mkdirSync(path.join(stage, 'l10n'), { recursive: true })
  for (const [index, [file]] of members.entries()) writeFileSync(file, packed[index])
  for (const locale of TABLE_LOCALES)
    rmSync(path.join(stage, 'l10n', `usage.${locale}.json`), { force: true })
}
