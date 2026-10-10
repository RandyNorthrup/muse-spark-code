// RVCM1141C P2: a Usage browser certification accepts ONLY the ready marker
// set after real Usage state rendered. An error shell, an empty shell or a
// loading state must fail the certification with a named reason.
//
// Part 1 drives the shared helper (test/harness/usageReadiness.mjs) with a
// stub page through each shell. Part 2 pins the whole class: every Usage
// readiness wait in the browser certifications must key on the marker, and
// the helper's expected copy must match the shipped table and fixture.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { fill } from '../../src/shared/l10n/text'
import { usageStateFor } from './helpers/usageFixtures'
import {
  assertUsageContent,
  assertUsageError,
  USAGE_HOST_LINE,
  USAGE_READY_SELECTOR,
  USAGE_SCENARIO_HEADINGS,
  USAGE_SETTLED_SELECTOR,
  waitForUsageReady,
  waitForUsageSettled,
} from '../harness/usageReadiness.mjs'

function stubPage(state) {
  const matches = (selector) => {
    if (selector === USAGE_READY_SELECTOR) return state.marker && !state.busy
    if (selector === USAGE_SETTLED_SELECTOR) return !state.busy
    if (selector === '[data-usage-ready="true"]') return state.marker
    throw new Error(`stub page: unexpected selector "${selector}"`)
  }
  return {
    locator: (selector) => ({
      waitFor: async () => {
        if (!matches(selector)) throw new Error(`waiting for locator "${selector}" found nothing`)
      },
      count: async () => (matches(selector) ? 1 : 0),
    }),
    getByRole: (role, options = {}) => ({
      waitFor: async () => {
        if (role === 'alert' && state.alert === null)
          throw new Error('waiting for role "alert" found nothing')
        if (role === 'heading' && !state.headings.includes(options.name))
          throw new Error(`waiting for heading "${options.name}" found nothing`)
      },
      count: async () => {
        if (role === 'alert') return state.alert === null ? 0 : 1
        return state.headings.includes(options.name) ? 1 : 0
      },
      textContent: async () => state.alert,
    }),
    getByText: (text) => {
      const waitFor = async () => {
        if (state.texts.every((line) => !line.includes(text)))
          throw new Error(`waiting for text "${text}" found nothing`)
      }
      return { waitFor, first: () => ({ waitFor }) }
    },
  }
}

const READ_FAILED = 'Usage history could not be read.'
// Initial error shell: `usage/error` before any state, so no marker.
const ERROR_SHELL = { marker: false, busy: false, alert: READ_FAILED, texts: [], headings: [] }
const LOADING_SHELL = { marker: false, busy: true, alert: null, texts: [], headings: [] }
const EMPTY_SHELL = { marker: false, busy: false, alert: null, texts: [], headings: [] }
// Post-load error shell: `usage/error` never clears `state`
// (src/webview/usage/UsageApp.tsx), so the rendered marker stays under the
// alert. The success assertion must refuse this shell via the alert, never
// by expecting the marker to clear.
const POST_LOAD_ERROR_SHELL = {
  marker: true,
  busy: false,
  alert: READ_FAILED,
  texts: [USAGE_HOST_LINE],
  headings: [],
}
const RENDERED_EMPTY = {
  marker: true,
  busy: false,
  alert: null,
  texts: [USAGE_HOST_LINE],
  headings: ['No usage yet'],
}

describe('usage browser readiness', () => {
  it('refuses an initial error shell: the marker wait names readiness', async () => {
    const page = stubPage(ERROR_SHELL)
    await expect(waitForUsageReady(page)).rejects.toThrow('data-usage-ready')
    await expect(assertUsageContent(page, { title: 'probe', scenario: 'empty' })).rejects.toThrow(
      'data-usage-ready',
    )
  })

  it('refuses a loading shell on both the success and the error wait', async () => {
    const page = stubPage(LOADING_SHELL)
    await expect(waitForUsageReady(page)).rejects.toThrow('data-usage-ready')
    await expect(waitForUsageSettled(page)).rejects.toThrow(USAGE_SETTLED_SELECTOR)
  })

  it('refuses an empty shell with a named reason', async () => {
    const page = stubPage(EMPTY_SHELL)
    await expect(waitForUsageReady(page)).rejects.toThrow('data-usage-ready')
    await expect(
      assertUsageContent(page, { title: 'probe', scenario: 'one-provider' }),
    ).rejects.toThrow('data-usage-ready')
  })

  it('accepts rendered host state with its fixture values', async () => {
    const page = stubPage(RENDERED_EMPTY)
    await expect(
      assertUsageContent(page, { title: 'probe', scenario: 'empty' }),
    ).resolves.toBeUndefined()
  })

  it('keeps the explicit error path: asserts the alert text', async () => {
    await expect(
      assertUsageError(stubPage(ERROR_SHELL), { title: 'probe', message: READ_FAILED }),
    ).resolves.toBeUndefined()
    await expect(
      assertUsageError(stubPage(ERROR_SHELL), { title: 'probe', message: 'Something else' }),
    ).rejects.toThrow('expected error')
  })

  it('refuses a post-load error through the alert, keeping the marker', async () => {
    const page = stubPage(POST_LOAD_ERROR_SHELL)
    // The marker stays: `usage/error` never clears rendered state.
    await expect(waitForUsageReady(page)).resolves.toBeUndefined()
    // The success assertion still refuses the shell, via the alert.
    await expect(
      assertUsageContent(page, { title: 'probe', scenario: 'one-provider' }),
    ).rejects.toThrow('must not show an error alert')
    // And the error assertion passes on the alert text.
    await expect(
      assertUsageError(page, { title: 'probe', message: READ_FAILED }),
    ).resolves.toBeUndefined()
  })

  it('expects the copy the shipped table and fixture render', () => {
    expect(USAGE_SCENARIO_HEADINGS.empty).toBe(USAGE_EN.emptyTitle)
    expect(USAGE_SCENARIO_HEADINGS['history-off']).toBe(USAGE_EN.historyOffTitle)
    expect(USAGE_HOST_LINE).toBe(
      fill(USAGE_EN.journalHost, { host: usageStateFor('empty').history.host }),
    )
  })

  it('keys every Usage browser wait on the ready marker', async () => {
    for (const file of [
      'test/harness/usage-check.mjs',
      'test/harness/usage-accounts.mjs',
      'test/harness/usage-companion.mjs',
      'test/harness/usage-resource-scenes.mjs',
    ]) {
      const source = await readFile(file, 'utf8')
      expect(source, `${file} must use the shared readiness helper`).toContain('usageReadiness.mjs')
    }
    // The shared helper alone defines the settled-only selector, for the
    // explicit error path; every other Usage wait must carry the marker.
    for (const file of [
      'test/harness/usage-check.mjs',
      'test/harness/usage-accounts.mjs',
      'test/harness/usage-companion.mjs',
      'test/harness/usage-resource-scenes.mjs',
      'test/harness/index.html',
      'scripts/lib/harnessServer.mjs',
      'test/unit/companionThemedBrowser.test.mjs',
      'test/unit/companionBrowser.test.ts',
      'test/unit/companionMediaBrowser.test.mjs',
    ]) {
      const source = await readFile(file, 'utf8')
      for (const line of source.split(/\r?\n/)) {
        if (!line.includes('.usage-page[aria-busy')) continue
        expect(line, `${file} accepts an idle shell: ${line.trim()}`).toContain('data-usage-ready')
      }
    }
  })
})
