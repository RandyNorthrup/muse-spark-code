// The pinned TypeScript grammar embeds JavaScript's complete implementation.
// Share the identical function already in the browser graph, without changing
// either grammar or writing to node_modules. A changed vendor shape refuses.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

function javascriptFunction(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const matches = source.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'javascript',
  )
  if (matches.length !== 1) throw new Error(`${file}: expected one JavaScript grammar`)
  return { source, declaration: matches[0] }
}

/** @type {import('esbuild').Plugin} */
export const sharedHighlightGrammar = {
  name: 'shared-highlight-grammar',
  setup(build) {
    build.onLoad({ filter: /highlight\.js[/\\]es[/\\]languages[/\\]typescript\.js$/ }, (args) => {
      const text = readFileSync(args.path, 'utf8')
      const otherPath = path.join(path.dirname(args.path), 'javascript.js')
      const otherText = readFileSync(otherPath, 'utf8')
      const { source, declaration } = javascriptFunction(args.path, text)
      const other = javascriptFunction(otherPath, otherText)
      if (declaration.getText(source) !== other.declaration.getText(other.source))
        throw new Error('TypeScript and JavaScript grammar implementations differ')
      return {
        contents:
          "import javascript from './javascript.js';\n" +
          text.slice(0, declaration.getStart(source)) +
          text.slice(declaration.end),
        loader: 'js',
        resolveDir: path.dirname(args.path),
      }
    })
  },
}
