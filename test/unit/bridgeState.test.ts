// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { companionStateStore } from '../../src/webview/bridges/state'

beforeEach(() => {
  window.sessionStorage.clear()
})

it('restores a JSON UI snapshot after a reload and keeps surfaces separate', () => {
  const initial = companionStateStore('chat', window.sessionStorage)
  initial.setState({ snapshot: { draft: 'unfinished', goal: undefined } })
  const reloaded = companionStateStore('chat', window.sessionStorage)
  expect(reloaded.getState()).toEqual({ snapshot: { draft: 'unfinished' } })
  expect(companionStateStore('tasks', window.sessionStorage).getState()).toBeUndefined()
})

it('refuses corrupted saved state rather than restoring unchecked data', () => {
  window.sessionStorage.setItem('muse-panel-ui:chat', '{')
  expect(() => companionStateStore('chat', window.sessionStorage).getState()).toThrow()
  expect(() => {
    companionStateStore('chat', window.sessionStorage).setState(undefined)
  }).toThrow()
})
