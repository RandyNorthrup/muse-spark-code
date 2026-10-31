import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { isEntryPoint } from './entryPoint.mjs'

// Parse the emitted JavaScript: string searches would also rewrite user/model
// text. UTF-16 source offsets are identical in the browser's fetched string.
export function portableManifest(
  meta,
  directory,
  readSource = (file) => readFileSync(file, 'utf8'),
) {
  const outputs = new Set(Object.keys(meta.outputs).map((file) => path.resolve(file)))
  const root = path.resolve(directory)
  const modules = Object.keys(meta.outputs)
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const source = readSource(file)
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const imports = []
      function visit(node) {
        let specifier
        let isDynamic = false
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          specifier = node.moduleSpecifier
        else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          specifier = node.arguments[0]
          isDynamic = true
        }
        if (specifier && ts.isStringLiteral(specifier)) {
          const target = path.resolve(path.dirname(file), specifier.text)
          if (!outputs.has(target)) throw new Error('MHP_MODULE_IMPORT_UNLISTED')
          const region = isDynamic ? node : specifier
          imports.push({
            start: region.getStart(tree),
            end: region.getEnd(),
            text: region.getText(tree),
            target: `/assets/portable/${path.relative(root, target).split(path.sep).join('/')}`,
            dynamic: isDynamic,
          })
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
      return {
        path: `/assets/portable/${path.relative(root, path.resolve(file)).split(path.sep).join('/')}`,
        bytes: Buffer.byteLength(source),
        sha256: createHash('sha256').update(source).digest('hex'),
        imports,
      }
    })
  return { modules }
}

export function writePortableManifest(meta, directory) {
  writeFileSync(
    path.join(directory, 'modules.json'),
    JSON.stringify(portableManifest(meta, directory)),
  )
}

// The fake-only process suites build the same graph into an isolated package.
if (isEntryPoint(import.meta.url))
  writePortableManifest(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3])
