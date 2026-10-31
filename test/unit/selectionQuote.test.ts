// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { selectedTranscriptQuote } from '../../src/webview/selectionQuote'

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

function row(id: string, text: string): HTMLElement {
  const element = document.createElement('div')
  element.dataset['entryId'] = id
  element.dataset['role'] = 'assistant'
  element.textContent = text
  document.body.append(element)
  return element
}

function select(element: HTMLElement): Selection {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  if (selection === null) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

it('quotes a selection whose endpoints and click share one live row', () => {
  const first = row('one', 'quoted words')
  const quote = selectedTranscriptQuote(select(first), first, { x: 3, y: 4 })
  expect(quote?.entryId).toBe('one')
  expect(quote?.text).toBe('quoted words')
  expect(quote?.role).toBe('assistant')
  expect(quote?.origin).toEqual({ x: 3, y: 4 })
})

it('refuses a click on another row and a selection spanning rows', () => {
  const first = row('one', 'first words')
  const second = row('two', 'second words')
  expect(selectedTranscriptQuote(select(first), second, { x: 1, y: 1 })).toBeUndefined()
  const range = document.createRange()
  range.setStart(first.firstChild as Node, 0)
  range.setEnd(second.firstChild as Node, 3)
  const selection = window.getSelection()
  if (selection === null) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  expect(selectedTranscriptQuote(selection, first, { x: 1, y: 1 })).toBeUndefined()
})

it('refuses an empty selection', () => {
  const first = row('one', 'words')
  window.getSelection()?.removeAllRanges()
  expect(selectedTranscriptQuote(window.getSelection(), first, { x: 1, y: 1 })).toBeUndefined()
})
