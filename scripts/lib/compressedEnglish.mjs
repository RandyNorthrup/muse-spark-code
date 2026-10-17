import { readFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import ts from 'typescript'

const ENGLISH_TABLE = path.resolve('src/shared/l10n/en.ts')
const COMPRESSION_LEVEL = 9

/** The table is data. Reject expressions instead of evaluating source code. */
export function englishTableData(source) {
  const file = ts.createSourceFile(ENGLISH_TABLE, source, ts.ScriptTarget.Latest, true)
  const read = (node) => {
    if (ts.isAsExpression(node)) return read(node.expression)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isPropertyAccessExpression(node.tag) &&
      ts.isIdentifier(node.tag.expression) &&
      node.tag.expression.text === 'String' &&
      node.tag.name.text === 'raw' &&
      ts.isNoSubstitutionTemplateLiteral(node.template)
    )
      return node.template.rawText
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => read(element))
    if (ts.isObjectLiteralExpression(node)) {
      const entries = new Map()
      for (const member of node.properties) {
        if (!ts.isPropertyAssignment(member) || !member.name || !('text' in member.name))
          throw new Error('English table must contain named data properties')
        const name = member.name.text
        if (entries.has(name)) throw new Error(`Duplicate English key: ${name}`)
        entries.set(name, read(member.initializer))
      }
      return Object.fromEntries(entries)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'forms' &&
      node.arguments.length === 1
    )
      return read(node.arguments[0])
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isArrayLiteralExpression(node.expression.expression) &&
      node.expression.name.text === 'join' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    )
      return read(node.expression.expression).join(node.arguments[0].text)
    throw new Error('English table must contain literal data only')
  }
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'EN' &&
        declaration.initializer
      )
        return read(declaration.initializer)
  }
  throw new Error('English table export is missing')
}

/** Build-time encoding only: the exported table's values and key order survive. */
export function compressedEnglish(platform) {
  return {
    name: 'compressed-english',
    setup(build) {
      build.onLoad({ filter: /[/\\]shared[/\\]l10n[/\\]en\.ts$/ }, (args) => {
        if (path.resolve(args.path) !== ENGLISH_TABLE) return
        const table = englishTableData(readFileSync(args.path, 'utf8'))
        const packed = deflateSync(JSON.stringify(table), { level: COMPRESSION_LEVEL }).toString(
          'base64',
        )
        const contents =
          platform === 'node'
            ? `import { inflateSync } from 'node:zlib'; export const EN = JSON.parse(inflateSync(Buffer.from('${packed}', 'base64')).toString('utf8'));`
            : `const packed = Uint8Array.from(atob('${packed}'), char => char.charCodeAt(0)); export const EN = JSON.parse(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'))).text());`
        return { contents, loader: 'js', watchFiles: [args.path] }
      })
    },
  }
}
