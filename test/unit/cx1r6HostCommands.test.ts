import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { COMMAND_IDS, OPTIONAL_RUNTIME_AVAILABILITY, UI_TEXT } from '../../src/shared/constants'
import { registerScheduleCommands } from '../../src/host/schedules/schedulesBridge'

const source = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('extension.ts', source, ts.ScriptTarget.Latest, true)

/** Execute the actual registered shim body with fake editor ports, without activating a backend. */
function callNamed(name: string): ts.CallExpression {
  let found: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (found === undefined) throw new Error('missing production registration: ' + name)
  return found
}

describe('CX1R6 hidden editor command invocation', () => {
  it('the installed estimate shim refuses before opening a conversation or inserting a draft', async () => {
    let callback: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(tree) === 'registerLoggedCommand' &&
        node.arguments[1]?.getText(tree) === 'COMMAND_IDS.estimate'
      )
        callback = node.arguments[2]
      ts.forEachChild(node, visit)
    }
    visit(tree)
    if (callback === undefined || !ts.isArrowFunction(callback))
      throw new Error('missing estimate shim')
    const openConversation = vi.fn().mockResolvedValue(undefined)
    const pending: unknown = new Script(`(${callback.getText(tree)})()`).runInNewContext({
      OPTIONAL_RUNTIME_AVAILABILITY,
      UI_TEXT,
      registry: { active: undefined },
      openConversation,
      isEstimatePending: false,
    })
    await expect(pending).rejects.toThrow(UI_TEXT.estimateRuntimeUnavailable)
    expect(openConversation).not.toHaveBeenCalled()
  })

  it('all three installed schedule command shims refuse even with the setting on', async () => {
    const config = callNamed('registerScheduleCommands').arguments[0]
    if (config === undefined || !ts.isObjectLiteralExpression(config))
      throw new Error('missing schedule ports')
    const property = config.properties.find(
      (entry) => ts.isPropertyAssignment(entry) && entry.name.getText(tree) === 'isEnabled',
    )
    if (property === undefined || !ts.isPropertyAssignment(property))
      throw new Error('missing schedule availability')
    const predicate = new Script(`(${property.initializer.getText(tree)})()`)
    const callbacks = new Map<string, () => Promise<void>>()
    const open = vi.fn().mockResolvedValue(undefined)
    const openConversation = vi.fn().mockResolvedValue(undefined)
    registerScheduleCommands({
      register: (id, action) => {
        callbacks.set(id, action)
        return { dispose: () => undefined }
      },
      active: () => ({}),
      isReady: () => true,
      isEnabled: () => {
        const enabled: unknown = predicate.runInNewContext({
          OPTIONAL_RUNTIME_AVAILABILITY,
          currentSettings: () => ({ schedules: true }),
        })
        return enabled === true
      },
      open,
      openConversation,
    })
    for (const id of [
      COMMAND_IDS.schedulePrompt,
      COMMAND_IDS.showSchedules,
      COMMAND_IDS.showScheduleTimeline,
    ]) {
      const callback = callbacks.get(id)
      if (callback === undefined) throw new Error('missing schedule command: ' + id)
      await expect(callback()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
    }
    expect(open).not.toHaveBeenCalled()
    expect(openConversation).not.toHaveBeenCalled()
  })
})
