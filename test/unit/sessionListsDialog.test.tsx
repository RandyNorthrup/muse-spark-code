// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../src/shared/constants'
import {
  backgroundTaskRowSchema,
  sessionHookRowSchema,
  sessionPluginRowSchema,
} from '../../src/shared/sessionLists'
import { SessionListsDialog } from '../../src/webview/components/SessionListsDialog'

// M127's session lists over recorded rows: the hook row below is the
// verbose SessionStart row the 1.4.9 echo capture served (disabled and
// untrusted), the tasks and plugins the empty lists from the same
// capture. Nothing is invented: the test parses the served shapes and
// asserts the dialog shows them, says empty, or says unavailable.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join('test', 'fixtures', 'm127', name), 'utf8'))

function recordedLists() {
  const hooks = z
    .array(sessionHookRowSchema)
    .parse((fixture('hook-list-1.4.9.json') as { hooks: unknown[] }).hooks)
  const tasks = z
    .array(backgroundTaskRowSchema)
    .parse((fixture('task-list-1.4.9.json') as { tasks: unknown[] }).tasks)
  const plugins = z
    .array(sessionPluginRowSchema)
    .parse((fixture('plugin-list-1.4.9.json') as { plugins: unknown[] }).plugins)
  return { tasks, hooks, plugins }
}

describe('SessionListsDialog', () => {
  it('shows the recorded rows under their section titles', () => {
    const lists = recordedLists()
    render(
      <SessionListsDialog
        lists={lists}
        now={() => Date.now()}
        onRefresh={() => undefined}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText(UI_TEXT.sessionListsTasks)).toBeDefined()
    expect(screen.getByText(UI_TEXT.sessionListsHooks)).toBeDefined()
    expect(screen.getByText(UI_TEXT.sessionListsPlugins)).toBeDefined()
    // The served hook row: key, event, handler kind and Off as captured.
    const hook = lists.hooks[0]
    if (hook === undefined) throw new Error('the capture served one hook row')
    expect(screen.getByText(hook.key)).toBeDefined()
    expect(
      screen.getByText(`${hook.event} · ${hook.handlerKind} · ${UI_TEXT.sessionListsDisabled}`),
    ).toBeDefined()
    // Empty lists say empty, twice (tasks and plugins).
    expect(screen.getAllByText(UI_TEXT.sessionListsEmpty)).toHaveLength(2)
  })

  it('says per section where the backend keeps none', () => {
    render(
      <SessionListsDialog
        lists={{}}
        now={() => Date.now()}
        onRefresh={() => undefined}
        onClose={() => undefined}
      />,
    )
    expect(screen.getAllByText(UI_TEXT.sessionListsUnavailable)).toHaveLength(3)
  })

  it('asks for a re-read from Refresh, and waits while the host answers', () => {
    let refreshes = 0
    const { rerender } = render(
      <SessionListsDialog
        lists={undefined}
        now={() => Date.now()}
        onRefresh={() => {
          refreshes += 1
        }}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText(UI_TEXT.loadingOutput)).toBeDefined()
    fireEvent.click(screen.getByText(UI_TEXT.sessionListsRefresh))
    expect(refreshes).toBe(1)
    rerender(
      <SessionListsDialog
        lists={recordedLists()}
        now={() => Date.now()}
        onRefresh={() => {
          refreshes += 1
        }}
        onClose={() => undefined}
      />,
    )
    expect(screen.queryByText(UI_TEXT.loadingOutput)).toBeNull()
  })
})
