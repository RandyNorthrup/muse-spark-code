// Lossless Node-only encoding of immutable model instructions. Keys remain
// literal so the existing block/readership split guards keep their full scope.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import ts from 'typescript'

const SOURCE = 'src/shared/constants.ts'
const BLOCKS = new Set(['MODEL_TEXT', 'MODEL_API_MODEL_TEXT', 'CODE_INTEL_MODEL_TEXT'])

/** @param {boolean} isProduction @returns {import('esbuild').Plugin} */
export function compressedModelText(isProduction) {
  return {
    name: 'compressed-model-text',
    setup(build) {
      build.onLoad({ filter: /[/\\]shared[/\\]constants\.ts$/ }, (args) => {
        if (!isProduction || path.resolve(args.path) !== path.resolve(SOURCE)) return
        const source = readFileSync(args.path, 'utf8')
        const tree = ts.createSourceFile(args.path, source, ts.ScriptTarget.Latest, true)
        const replacements = []
        for (const statement of tree.statements) {
          if (!ts.isVariableStatement(statement)) continue
          for (const declaration of statement.declarationList.declarations) {
            if (!BLOCKS.has(declaration.name.getText(tree))) continue
            const literal = declaration.initializer
            if (
              literal === undefined ||
              !ts.isAsExpression(literal) ||
              !ts.isObjectLiteralExpression(literal.expression)
            )
              throw new Error('Model text must be a literal object')
            const entries = literal.expression.properties.map((property) => {
              if (
                !ts.isPropertyAssignment(property) ||
                !ts.isIdentifier(property.name) ||
                (!ts.isStringLiteral(property.initializer) &&
                  !ts.isNoSubstitutionTemplateLiteral(property.initializer))
              )
                throw new Error('Model text must contain literal strings only')
              return [property.name.text, property.initializer.text]
            })
            const packed = brotliCompressSync(
              JSON.stringify(entries.map(([, value]) => value)),
            ).toString('base64')
            const keys = entries.map(([key], index) => `${key}:values[${String(index)}]`).join(',')
            // The IIFE is pure because its only input is our canonical literal table.
            // Unused blocks still disappear completely, including their decoder.
            const contents = `/* @__PURE__ */(()=>{const values=unpackModelText(${JSON.stringify(packed)});return {${keys}}})()`
            replacements.push({ start: literal.getStart(tree), end: literal.end, contents })
          }
        }
        if (replacements.length !== BLOCKS.size) throw new Error('A model text block disappeared')
        let contents = source
        for (const replacement of replacements.toReversed())
          contents =
            contents.slice(0, replacement.start) +
            replacement.contents +
            contents.slice(replacement.end)
        contents = `const unpackModelText=(packed)=>JSON.parse(require('node:zlib').brotliDecompressSync(Buffer.from(packed,'base64')).toString('utf8'));\n${contents}`
        return {
          contents,
          loader: 'ts',
          resolveDir: path.dirname(args.path),
          watchFiles: [args.path],
        }
      })
    },
  }
}
