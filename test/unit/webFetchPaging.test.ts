// A long page is pageable end to end: each window names the characters
// shown, the total and the offset that fetches the rest; a past-end offset
// is refused with the valid range. Pure through the real page renderer.
import { describe, expect, it } from 'vitest'
import { pageText, type WebPage } from '../../src/core/web/webFetch'
import { WEB_FETCH_MAX_CONTENT_CHARS } from '../../src/shared/constants'

const page: WebPage = {
  url: 'https://example.com/doc',
  finalUrl: 'https://example.com/doc',
  status: 200,
  type: 'text/plain',
  bytes: 100,
}

describe('pageText windows', () => {
  it('shows a short page whole with no window note', () => {
    const text = pageText(page, 'hello', { isHtml: false, hasMore: false }, 'm1')
    expect(text).toContain('<<<page m1>>>\nhello\n<<<end of page m1>>>')
    expect(text).not.toContain('offset')
  })

  it('pages a long page and names the next offset', () => {
    const content = 'x'.repeat(WEB_FETCH_MAX_CONTENT_CHARS + 10)
    const first = pageText(page, content, { isHtml: false, hasMore: false }, 'm1', 0)
    expect(first).toContain(
      `Showing characters 1–${String(WEB_FETCH_MAX_CONTENT_CHARS)} of ${String(WEB_FETCH_MAX_CONTENT_CHARS + 10)}; fetch https://example.com/doc again with offset ${String(WEB_FETCH_MAX_CONTENT_CHARS)} for the rest.`,
    )
    const rest = pageText(
      page,
      content,
      { isHtml: false, hasMore: false },
      'm2',
      WEB_FETCH_MAX_CONTENT_CHARS,
    )
    expect(rest).toContain('xxxxxxxxxx')
    expect(rest).not.toContain('for the rest.')
  })

  it('refuses a past-end offset with the valid range', () => {
    const text = pageText(page, 'hello', { isHtml: false, hasMore: false }, 'm1', 5)
    expect(text).toContain(
      'Offset 5 is past the end of this page (5 characters); fetch https://example.com/doc again with an offset from 0 to 4 for the rest.',
    )
  })
})
