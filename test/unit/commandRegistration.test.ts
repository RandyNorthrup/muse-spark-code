// RVM100W P1: every contributed command has a registration in the code that
// activates it. The manifest test only compares the manifest with
// COMMAND_IDS; this one reads the registration calls themselves, so deleting
// a `registerLoggedCommand` (as lane W once did for openInNewTab) fails here
// instead of turning a menu item, shortcut or Help entry into "command not
// found".
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { COMMAND_IDS, PROMPT_COMMAND_IDS } from '../../src/shared/constants'
import { TAB_COMMAND_IDS } from '../../src/host/tab/tabBundle'

vi.mock('vscode', async () => await import('./mocks/vscode'))

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { commands: { command: string }[] }
}
const ID_TABLES = new Map(
  Object.entries({ COMMAND_IDS, PROMPT_COMMAND_IDS, TAB_COMMAND_IDS }).map(([name, table]) => [
    name,
    new Map<string, string>(Object.entries(table)),
  ]),
)
const REGISTERING_FILES = ['src/extension.ts', 'src/host/tab/tabBundle.ts']

/** The command ids an id argument names: a table entry, a literal, or a loop over a table. */
function idsOf(argument: ts.Expression, call: ts.Node): string[] {
  if (ts.isStringLiteral(argument)) return [argument.text]
  if (ts.isPropertyAccessExpression(argument) && ts.isIdentifier(argument.expression)) {
    const value = ID_TABLES.get(argument.expression.text)?.get(argument.name.text)
    return value === undefined ? [] : [value]
  }
  if (ts.isConditionalExpression(argument))
    return [...idsOf(argument.whenTrue, call), ...idsOf(argument.whenFalse, call)]
  if (ts.isIdentifier(argument)) {
    const loop = ts.findAncestor(
      call,
      (node): node is ts.ForOfStatement =>
        ts.isForOfStatement(node) &&
        ts.isVariableDeclarationList(node.initializer) &&
        node.initializer.declarations[0]?.name.getText() === argument.text,
    )
    if (
      loop !== undefined &&
      ts.isCallExpression(loop.expression) &&
      loop.expression.expression.getText() === 'Object.values'
    ) {
      const table = ID_TABLES.get(loop.expression.arguments[0]?.getText() ?? '')
      return [...(table?.values() ?? [])]
    }
  }
  return []
}

function registeredCommands(): Set<string> {
  const registered = new Set<string>()
  for (const file of REGISTERING_FILES) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source)
        let argument: ts.Expression | undefined
        if (callee === 'registerLoggedCommand') argument = node.arguments[1]
        else if (callee.endsWith('.registerCommand')) argument = node.arguments[0]
        if (argument !== undefined) for (const id of idsOf(argument, node)) registered.add(id)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return registered
}

describe('RVM100W command registrations', () => {
  it('registers every command the manifest contributes', () => {
    const registered = registeredCommands()
    const missing = manifest.contributes.commands
      .map((command) => command.command)
      .filter((command) => !registered.has(command))
    expect(missing).toEqual([])
  })

  it('reads the open-in-new-tab registration the shortcut and Help entry rely on', () => {
    expect(registeredCommands()).toContain(COMMAND_IDS.openInNewTab)
  })
})
