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
import { RECORDING_COMMAND_IDS } from '../../src/host/media/screenRecordBundle'
import { VAULT_COMMANDS } from '../../src/host/vault/vaultPanelBundle'

vi.mock('vscode', async () => await import('./mocks/vscode'))

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { commands: { command: string }[] }
}
const ID_TABLES = new Map(
  Object.entries({
    COMMAND_IDS,
    PROMPT_COMMAND_IDS,
    TAB_COMMAND_IDS,
    RECORDING_COMMAND_IDS,
    VAULT_COMMANDS,
  }).map(([name, table]) => [name, new Map<string, string>(Object.entries(table))]),
)
const REGISTERING_FILES = ['src/extension.ts', 'src/host/tab/tabBundle.ts']
const FACTORY_FILES = new Map([
  ['registerScheduleCommands', 'src/host/schedules/schedulesBridge.ts'],
  ['registerVaultCommands', 'src/host/vault/vaultPanelBundle.ts'],
])

/** Resolve the actual callback parameter from a table/tuple map, never all references to an id. */
function mappedIds(argument: ts.Identifier, call: ts.Node): string[] {
  const callback = ts.findAncestor(
    call,
    (node): node is ts.ArrowFunction =>
      ts.isArrowFunction(node) &&
      ts.isCallExpression(node.parent) &&
      ts.isPropertyAccessExpression(node.parent.expression) &&
      node.parent.expression.name.text === 'map',
  )
  if (
    callback === undefined ||
    !ts.isCallExpression(callback.parent) ||
    !ts.isPropertyAccessExpression(callback.parent.expression)
  )
    return []
  const parameter = callback.parameters[0]?.name
  if (parameter === undefined || !ts.isArrayBindingPattern(parameter)) return []
  const index = parameter.elements.findIndex(
    (entry) => ts.isBindingElement(entry) && entry.name.getText() === argument.text,
  )
  if (index === -1) return []
  let input: ts.Expression = callback.parent.expression.expression
  if (index === 1 && ts.isCallExpression(input) && input.expression.getText() === 'Object.entries')
    return [...(ID_TABLES.get(input.arguments[0]?.getText() ?? '')?.values() ?? [])]
  while (ts.isParenthesizedExpression(input) || ts.isAsExpression(input)) input = input.expression
  if (!ts.isArrayLiteralExpression(input)) return []
  return input.elements.flatMap((entry) => {
    if (!ts.isArrayLiteralExpression(entry)) return []
    const value = entry.elements[index]
    return value === undefined ? [] : idsOf(value, call)
  })
}

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
    return mappedIds(argument, call)
  }
  return []
}

function registeredCommands(overrides: ReadonlyMap<string, string> = new Map()): Set<string> {
  const registered = new Set<string>()
  const files = [...REGISTERING_FILES]
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      overrides.get(file) ?? readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source)
        let argument: ts.Expression | undefined
        const factoryFile = FACTORY_FILES.get(callee)
        if (
          file === 'src/extension.ts' &&
          factoryFile !== undefined &&
          !files.includes(factoryFile)
        )
          files.push(factoryFile)
        if (callee === 'registerLoggedCommand') argument = node.arguments[1]
        else if (
          callee.endsWith('.registerCommand') ||
          (callee === 'register' && file === FACTORY_FILES.get('registerVaultCommands')) ||
          (callee === 'ports.register' && file === FACTORY_FILES.get('registerScheduleCommands'))
        )
          argument = node.arguments[0]
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

  it.each(Array.from(FACTORY_FILES, ([factory]) => factory))(
    'refuses %s commands when activation does not call the factory',
    (factory) => {
      const source = readFileSync('src/extension.ts', 'utf8')
      const disabled = source.replace(`${factory}(`, 'removedFactory(')
      expect(disabled).not.toBe(source)
      const commands = registeredCommands(new Map([['src/extension.ts', disabled]]))
      const expected =
        factory === 'registerVaultCommands'
          ? Object.values(VAULT_COMMANDS)
          : [
              COMMAND_IDS.schedulePrompt,
              COMMAND_IDS.showSchedules,
              COMMAND_IDS.showScheduleTimeline,
            ]
      for (const command of expected) expect(commands).not.toContain(command)
    },
  )

  it('reads the open-in-new-tab registration the shortcut and Help entry rely on', () => {
    expect(registeredCommands()).toContain(COMMAND_IDS.openInNewTab)
  })
})
