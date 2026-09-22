// Guards against drift between package.json contribution points and the ids
// the code registers against.

import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import {
  CHAT_VIEW_ID,
  COMMAND_IDS,
  EXTENSION_NAME,
  EXTENSION_PUBLISHER,
} from '../../src/shared/constants'

describe('package.json manifest', () => {
  it('identifies the extension the way constants.ts expects', () => {
    expect(manifest.name).toBe(EXTENSION_NAME)
    expect(manifest.publisher).toBe(EXTENSION_PUBLISHER)
    expect(manifest.main).toBe('./dist/extension.js')
  })

  it('contributes the chat view the provider registers', () => {
    const viewIds = Object.values(manifest.contributes.views)
      .flat()
      .map((view) => view.id)
    expect(viewIds).toEqual([CHAT_VIEW_ID])
  })

  it('contributes exactly the commands the extension registers', () => {
    const contributed = manifest.contributes.commands.map((command) => command.command)
    const registered = Object.values(COMMAND_IDS)
    expect(new Set(contributed)).toEqual(new Set(registered))
    expect(contributed).toHaveLength(registered.length)
  })

  it('pins @types/vscode to the engines.vscode minimum', () => {
    const engine = /^\^(\d+\.\d+)\.\d+$/.exec(manifest.engines.vscode)?.[1]
    const types = /^(\d+\.\d+)\.\d+$/.exec(manifest.devDependencies['@types/vscode'])?.[1]
    expect(engine).toBeDefined()
    expect(types).toBe(engine)
  })
})
