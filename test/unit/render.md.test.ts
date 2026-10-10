import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPORT_KINDS } from '../../src/shared/constants'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { GOLDEN_ROOT, RENDERERS, REPORT_THEME, renderFixture } from './reportRenderFixtures'

describe('report Markdown', () => {
  it.each(REPORT_KINDS)('matches the %s Markdown golden', async (kind) => {
    expect(RENDERERS.md(renderFixture(kind), 'en', REPORT_THEME)).toBe(
      await readFile(path.join(GOLDEN_ROOT, `${kind}.md.golden`), 'utf8'),
    )
  })
  it('escapes table pipes, source HTML, links, images and entity syntax as data', () => {
    const document = renderFixture()
    document.sections[0]!.rows[0]!.cells['name'] = {
      type: 'text',
      value: '| <script>alert(1)</script> ![image](https://evil.invalid/pixel) &amp;\r\nnext',
    }
    const output = RENDERERS.md(finalizeReport(document), 'en', REPORT_THEME)
    expect(output).toContain('&#124;')
    expect(output).toContain('&#60;script&#62;')
    expect(output).toContain('&#33;&#91;image&#93;&#40;https://evil')
    expect(output).not.toContain('<script>')
    expect(output).not.toContain('![image]')
    expect(output).not.toContain('\r')
    expect(output).toContain('<br>next')
    expect(output.endsWith('\n\n')).toBe(false)
  })
  it('puts Needs you before releases and shows omitted counts and every source status', () => {
    const output = RENDERERS.md(renderFixture(), 'en', REPORT_THEME)
    expect(output.indexOf('## Needs you')).toBeLessThan(output.indexOf('## Releases'))
    expect(output).toContain('12 more')
    for (const status of ['Available', 'Partial', 'Unavailable', 'Not applicable', 'Unknown'])
      expect(output).toContain(status)
    expect(output).toContain('Network is off.')
    expect(output).toContain('Renderer 1; ICU 77.1; locale en')
  })
})
