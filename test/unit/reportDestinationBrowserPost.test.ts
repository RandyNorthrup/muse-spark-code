import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { openReportInBrowser } from '../../src/core/reporting/destinations/browser'
import { ReportPostDelivery } from '../../src/core/reporting/destinations/post'
import { reportScrubber } from '../../src/core/reporting/render/redaction'
import { UI_TEXT } from '../../src/shared/constants'
import { deliveryPayload, runnerRig } from './helpers/reporting/destinations'

const target = { repository: 'owner/project', number: 12, kind: 'statusIssue' as const }
const insecureNodeUrl = new URL('https://node.example.test/private/reports/one')
insecureNodeUrl.protocol = 'http:'
describe('browser report destinations', () => {
  it('waits without publishing or opening until the user returns', async () => {
    const { browser } = runnerRig()
    browser.hasActiveSession.mockResolvedValue(false)
    expect(await openReportInBrowser(browser, 'one', deliveryPayload(), 'node')).toBe('waiting')
    expect(browser.open).not.toHaveBeenCalled()
    expect(browser.publishHtml).not.toHaveBeenCalled()
    browser.hasActiveSession.mockResolvedValue(true)
    expect(await openReportInBrowser(browser, 'one', deliveryPayload(), 'node')).toBe('opened')
    expect(browser.open).toHaveBeenCalledWith('https://node.example.test/private/reports/one')
  })
  it('rechecks activity after publishing and authentication', async () => {
    const { browser } = runnerRig()
    browser.hasActiveSession.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await openReportInBrowser(browser, 'one', deliveryPayload(), 'node')).toBe('waiting')
    expect(browser.open).not.toHaveBeenCalled()
  })
  it.each([
    'https://public.example.test/report',
    insecureNodeUrl.href,
    'https://user:password@node.example.test/report',
  ])('refuses public or unsafe URL %s', async (url) => {
    const { browser } = runnerRig()
    browser.publishHtml.mockResolvedValue({ type: 'node', url })
    browser.isAuthenticatedReportUrl.mockResolvedValue(!url.startsWith('https://public.'))
    await expect(openReportInBrowser(browser, 'one', deliveryPayload(), 'node')).rejects.toThrow()
    expect(browser.open).not.toHaveBeenCalled()
  })
  it('opens a local file URL with portable escaping, and rejects a storage mismatch', async () => {
    const { browser } = runnerRig()
    browser.publishHtml.mockResolvedValue({ type: 'local', path: path.resolve('own report.html') })
    expect(await openReportInBrowser(browser, 'one', deliveryPayload(), 'local')).toBe('opened')
    expect(browser.open.mock.calls[0]![0]).toMatch(/^file:.*own%20report\.html$/)
    browser.open.mockClear()
    await expect(openReportInBrowser(browser, 'one', deliveryPayload(), 'node')).rejects.toThrow()
    expect(browser.open).not.toHaveBeenCalled()
  })
  it('refuses relative local paths and malformed publisher replies', async () => {
    const { browser } = runnerRig()
    browser.publishHtml.mockResolvedValue({ type: 'local', path: '../foreign.html' })
    await expect(openReportInBrowser(browser, 'one', deliveryPayload(), 'local')).rejects.toThrow()
    Reflect.set(browser, 'publishHtml', () =>
      Promise.resolve({ type: 'public', url: 'https://public.example.test' }),
    )
    await expect(openReportInBrowser(browser, 'one', deliveryPayload(), 'node')).rejects.toThrow()
    expect(browser.open).not.toHaveBeenCalled()
  })
})
describe('opt-in report posting', () => {
  it('requires separate opt-in and full first-post confirmation for the kind and target', async () => {
    const { postPort } = runnerRig()
    const post = new ReportPostDelivery(postPort)
    postPort.isEnabled.mockResolvedValue(false)
    expect(await post.confirm(target, deliveryPayload())).toBe(false)
    const deliveryResult1 = await post.post('one', 'post', target, deliveryPayload())
    expect(deliveryResult1.status).toBe('failed')
    expect(postPort.previewAndConfirm).not.toHaveBeenCalled()
    postPort.isEnabled.mockResolvedValue(true)
    postPort.isConfirmed.mockResolvedValue(false)
    const deliveryResult2 = await post.post('one', 'post', target, deliveryPayload())
    expect(deliveryResult2.status).toBe('failed')
    expect(postPort.publish).not.toHaveBeenCalled()
    postPort.previewAndConfirm.mockResolvedValue(false)
    expect(await post.confirm(target, deliveryPayload())).toBe(false)
    expect(postPort.rememberConfirmation).not.toHaveBeenCalled()
    postPort.previewAndConfirm.mockResolvedValue(true)
    expect(await post.confirm(target, deliveryPayload())).toBe(true)
    expect(postPort.previewAndConfirm).toHaveBeenCalledWith(
      'project',
      target,
      reportScrubber()(`${deliveryPayload().markdown}\n\n${UI_TEXT.reportUi.automatedNote}\n`),
    )
    expect(postPort.rememberConfirmation).toHaveBeenCalledWith('project', target)
  })
  it.each(['statusIssue', 'pullRequestComment', 'issueComment'] as const)(
    'passes the exact %s operation to existing authenticated publisher and scrubs with automated note',
    async (kind) => {
      const { postPort } = runnerRig()
      const post = new ReportPostDelivery(postPort)
      const canary = 'ghp_' + 'a'.repeat(36)
      const selected = { ...target, kind }
      const deliveryResult3 = await post.post('one', 'post', selected, {
        ...deliveryPayload(),
        markdown: canary,
      })
      expect(deliveryResult3.status).toBe('delivered')
      const [actual, body, context] = postPort.publish.mock.calls[0]!
      expect(actual).toEqual(selected)
      expect(body).not.toContain(canary)
      expect(body).toContain(UI_TEXT.reportUi.automatedNote)
      expect(context).toMatchObject({
        requester: 'schedule:one',
        idempotencyKey: expect.stringContaining(':post'),
      })
    },
  )
  it('rejects malformed upstream delivery receipts', async () => {
    const { postPort } = runnerRig()
    postPort.publish.mockResolvedValue({ status: 'success', token: 'unexpected' })
    await expect(
      new ReportPostDelivery(postPort).post('one', 'post', target, deliveryPayload()),
    ).rejects.toThrow()
  })
})
