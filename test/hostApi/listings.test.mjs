import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sentence = 'Enjoying Muse Spark Code? A star on GitHub helps other people find it.'
const repository = 'https://github.com/RandyNorthrup/muse-spark-code'

describe('owned package listing descriptions', () => {
  it.each([
    'README.md',
    'docs/npm-readme.md',
    'docs/acp.md',
    'hosts/xcode/README.md',
    'scripts/package-hosts/README.md',
  ])('%s includes the exact linked owner sentence', (file) => {
    expect(readFileSync(file, 'utf8')).toContain(`[${sentence}](${repository})`)
  })
  it('ships the exact linked sentence in the native app and extension description', () => {
    const page = new JSDOM(readFileSync('hosts/xcode/description.html', 'utf8'))
    const link = page.window.document.querySelector(':scope a')
    expect(link?.getAttribute('href')).toBe(repository)
    expect(link?.textContent).toBe(sentence)
    page.window.close()
    const project = readFileSync('hosts/xcode/MuseSpark.xcodeproj/project.pbxproj', 'utf8')
    expect(project).toContain('"path" = "description.html"')
    for (const resource of ['F104F0000000000000000002', 'F104F0000000000000000003'])
      expect(project.match(new RegExp(resource, 'gu'))).toHaveLength(2)
  })
})
