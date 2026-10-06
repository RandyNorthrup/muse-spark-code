import type * as vscode from 'vscode'
import { vi } from 'vitest'
import { workspace } from '../mocks/vscode'

/** The real API's generic overloads; Vitest spies supply the test's raw setting. */
function get(section: string): undefined
function get<T>(section: string, defaultValue: T): T
function get<T>(_section: string, defaultValue?: T): T | undefined {
  return defaultValue
}

/** A complete configuration fake without casting away the API's generic methods. */
export function mockJudgePaidConfiguration(budget?: unknown) {
  const update = vi.fn<vscode.WorkspaceConfiguration['update']>().mockResolvedValue(undefined)
  const configuration: vscode.WorkspaceConfiguration = {
    get,
    has: () => false,
    inspect: () => undefined,
    update,
  }
  const read = vi.spyOn(configuration, 'get').mockReturnValue(budget)
  vi.mocked(workspace.getConfiguration).mockReturnValue(configuration)
  return { get: read, update }
}
