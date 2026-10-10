// RVCM1141C P2: a Usage browser certification accepts ONLY the ready marker
// set after real Usage state rendered. An error shell, an empty shell or a
// loading state must fail the certification with a named reason.
// RVCM1141D P3: a post-load error keeps the marker under the alert, so every
// success wait must also refuse the alert (assertUsageContent), and the
// harness http page must carry the companion theme nonce or it never mounts.
//
// Part 1 drives the shared helper (test/harness/usageReadiness.mjs) with a
// stub page through each shell. Part 2 pins the whole class: every Usage
// readiness wait in the browser certifications must key on the marker, no
// certification may wait on the bare marker, the harness page must carry the
// nonce, and the helper's expected copy must match the shipped table and
// fixture.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { fill } from '../../src/shared/l10n/text'
import { usageStateFor } from './helpers/usageFixtures'
import {
  assertUsageContent,
  assertUsageError,
  assertUsageResourceInvalid,
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
    if (selector === 'section.usage-resources') return state.section !== false
    throw new Error(`stub page: unexpected selector "${selector}"`)
  }
  const sectionAlert = (selector) => {
    const present = matches(selector) && state.sectionAlert !== null
    return {
      waitFor: async () => {
        if (!present) throw new Error(`waiting for locator "${selector}" alert found nothing`)
      },
      textContent: async () => state.sectionAlert,
    }
  }
  return {
    locator: (selector) => ({
      waitFor: async () => {
        if (!matches(selector)) throw new Error(`waiting for locator "${selector}" found nothing`)
      },
      count: async () => (matches(selector) ? 1 : 0),
      getByRole: (role) => {
        if (selector === 'section.usage-resources' && role === 'alert')
          return sectionAlert(selector)
        throw new Error(`stub page: unexpected scoped role "${role}" on "${selector}"`)
      },
    }),
    // A page-level alert query sees every alert on the page, including a
    // section-scoped one, the way Playwright's page.getByRole does.
    getByRole: (role, options = {}) => ({
      waitFor: async () => {
        if (role === 'alert' && state.alert === null && state.sectionAlert === null)
          throw new Error('waiting for role "alert" found nothing')
        if (role === 'heading' && !state.headings.includes(options.name))
          throw new Error(`waiting for heading "${options.name}" found nothing`)
      },
      count: async () => {
        if (role === 'alert') return state.alert === null && state.sectionAlert === null ? 0 : 1
        return state.headings.includes(options.name) ? 1 : 0
      },
      textContent: async () => state.alert ?? state.sectionAlert,
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
const RESOURCE_INVALID = 'Resource history could not be read.'
// Initial error shell: `usage/error` before any state, so no marker.
const ERROR_SHELL = {
  marker: false,
  busy: false,
  alert: READ_FAILED,
  texts: [],
  headings: [],
  section: false,
  sectionAlert: null,
}
const LOADING_SHELL = {
  marker: false,
  busy: true,
  alert: null,
  texts: [],
  headings: [],
  section: false,
  sectionAlert: null,
}
const EMPTY_SHELL = {
  marker: false,
  busy: false,
  alert: null,
  texts: [],
  headings: [],
  section: false,
  sectionAlert: null,
}
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
  section: true,
  sectionAlert: null,
}
const RENDERED_EMPTY = {
  marker: true,
  busy: false,
  alert: null,
  texts: [USAGE_HOST_LINE],
  headings: ['No usage yet'],
  section: true,
  sectionAlert: null,
}
// Unreadable resource journal: the Usage state renders (marker stays) and
// only the Resources section shows its invalid-history alert
// (src/webview/usage/ResourcesSection.tsx).
const RESOURCE_INVALID_SHELL = {
  marker: true,
  busy: false,
  alert: null,
  texts: [USAGE_HOST_LINE],
  headings: [],
  section: true,
  sectionAlert: RESOURCE_INVALID,
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

  it('certifies an unreadable resource journal through the marker plus the section alert', async () => {
    const page = stubPage(RESOURCE_INVALID_SHELL)
    // The marker alone would pass this shell; the resource assertion names
    // the section failure instead.
    await expect(waitForUsageReady(page)).resolves.toBeUndefined()
    await expect(
      assertUsageResourceInvalid(page, { title: 'probe', message: RESOURCE_INVALID }),
    ).resolves.toBeUndefined()
    await expect(
      assertUsageResourceInvalid(page, { title: 'probe', message: 'Something else' }),
    ).rejects.toThrow('expected resource error')
    // Without the marker (initial error shell) the resource assertion fails.
    await expect(
      assertUsageResourceInvalid(stubPage(ERROR_SHELL), {
        title: 'probe',
        message: RESOURCE_INVALID,
      }),
    ).rejects.toThrow('data-usage-ready')
    // And the page-level success assertion refuses the section alert too.
    await expect(
      assertUsageContent(page, { title: 'probe', scenario: 'one-provider' }),
    ).rejects.toThrow('must not show an error alert')
  })

  it('checks the companion host line the caller passes, not the fixture machine', async () => {
    const line = 'History is stored on JetBrains.'
    const page = stubPage({
      ...RENDERED_EMPTY,
      texts: [line],
    })
    await expect(
      assertUsageContent(page, { title: 'probe', scenario: 'empty', hostLine: line }),
    ).resolves.toBeUndefined()
    await expect(assertUsageContent(page, { title: 'probe', scenario: 'empty' })).rejects.toThrow(
      USAGE_HOST_LINE,
    )
  })

  it('mounts the harness http page: the root carries the companion theme nonce', async () => {
    const html = await readFile('test/harness/usage.html', 'utf8')
    expect(html, 'usage.html must mirror the served companion document').toContain(
      'data-theme-nonce',
    )
    const nonce = html.match(/data-theme-nonce="([^"]*)"/)?.[1]
    expect(nonce, 'harness nonce must satisfy the companion nonce pattern').toMatch(
      /^[a-f\d]{32,}$/,
    )
  })

  it('certifies every post-load wait through a content assertion, never a bare marker wait', async () => {
    // A post-load `usage/error` keeps the marker under the alert
    // (src/webview/usage/UsageApp.tsx), so a bare waitForUsageReady in a
    // certification would pass a failed refresh. Success waits assert
    // content (no alert); explicit error sync uses waitForUsageSettled or
    // an alert assertion. The shared helper alone defines the waits.
    for (const file of [
      'test/harness/usage-check.mjs',
      'test/harness/usage-accounts.mjs',
      'test/harness/usage-companion.mjs',
      'test/harness/usage-resource-scenes.mjs',
    ]) {
      const source = await readFile(file, 'utf8')
      expect(source, `${file} must use the shared readiness helper`).toContain('usageReadiness.mjs')
      expect(source, `${file} waits on the bare marker: ${file}`).not.toContain(
        'waitForUsageReady(',
      )
    }
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
