import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.dirname(here)
const repoRoot = path.resolve(pluginRoot, '..', '..')
const REPO_URL = 'https://github.com/RandyNorthrup/muse-spark-code'

const manifest = readFileSync(path.join(pluginRoot, 'source.extension.vsixmanifest'), 'utf8')
const project = readFileSync(path.join(pluginRoot, 'MuseSpark.VisualStudio.csproj'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

function tag(name) {
  const open = manifest.indexOf(`<${name}`)
  const contentStart = open === -1 ? -1 : manifest.indexOf('>', open)
  const close = contentStart === -1 ? -1 : manifest.indexOf(`</${name}>`, contentStart)
  assert.ok(close !== -1, `manifest is missing <${name}>`)
  return manifest.slice(contentStart + 1, close).trim()
}

function listVsFilesRecursively(directory, into) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) {
      listVsFilesRecursively(full, into)
    } else {
      into.push(full)
    }
  }
  return into
}

describe('Visual Studio marketplace listing', () => {
  it('names a short display name and a real description without the protocol version', () => {
    const displayName = tag('DisplayName')
    assert.ok(displayName.length <= 50, `DisplayName is ${displayName.length} characters`)
    const description = tag('Description')
    assert.ok(description.length <= 1000, `Description is ${description.length} characters`)
    assert.ok(description.includes('Unofficial'), 'Description names Unofficial')
    assert.ok(
      description.includes('not affiliated with or endorsed by Meta'),
      'Description carries the non-affiliation sentence',
    )
    assert.ok(!description.includes('mhp/'), 'Description carries no protocol version')
  })

  it('links the repository and the changelog', () => {
    assert.equal(tag('MoreInfo'), REPO_URL)
    assert.ok(
      tag('ReleaseNotes').startsWith(REPO_URL),
      'ReleaseNotes starts with the repository URL',
    )
  })

  it('ships a .txt licence and a packaged product icon', () => {
    const license = tag('License')
    assert.ok(license.endsWith('.txt'), `License ${license} has no .txt extension`)
    for (const name of ['Icon', 'PreviewImage']) {
      const file = tag(name)
      const linked = new RegExp(
        `<Content Include="[^"]*"><Link>${file.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}</Link><IncludeInVSIX>true</IncludeInVSIX></Content>`,
      )
      assert.ok(linked.test(project), `<${name}> ${file} is not linked with IncludeInVSIX`)
    }
    assert.ok(
      project.includes(String.raw`<Content Include="..\..\media\icon.png"><Link>icon.png</Link>`),
      String.raw`the icon is linked from ..\..\media\icon.png`,
    )
    const png = readFileSync(path.join(repoRoot, 'media', 'icon.png'))
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    assert.equal(width, 128)
    assert.equal(height, 128)
  })

  it('tags within the schema budget', () => {
    const tags = tag('Tags')
    assert.ok(tags.length <= 100, `Tags are ${tags.length} characters`)
    const parts = tags.split(';')
    assert.ok(parts.length > 1, 'Tags are semicolon-separated')
    for (const part of parts) {
      assert.ok(part.trim().length > 0, 'Tags contain no empty tag')
    }
  })

  it('targets only qualified architectures', () => {
    const arches = manifest
      .matchAll(/<ProductArchitecture>([\s\S]*?)<\/ProductArchitecture>/g)
      .map((match) => match[1].trim())
      .toArray()
    assert.ok(arches.length > 0, 'no installation target found')
    for (const arch of arches) {
      assert.equal(arch, 'amd64')
    }
  })

  it('versions the manifest and the project with the product', () => {
    const identity = manifest.match(/<Identity[^>]*Version="([^"]*)"/)
    assert.ok(identity, 'manifest Identity has no Version')
    const projectVersion = project.match(/<Version>([\s\S]*?)<\/Version>/)
    assert.ok(projectVersion, 'project file has no <Version>')
    assert.equal(identity[1], projectVersion[1].trim())
    assert.equal(identity[1], packageJson.version)
  })

  it("never references the other company's logo path", () => {
    const files = listVsFilesRecursively(pluginRoot, [])
    for (const file of files) {
      if (path.resolve(file) === path.resolve(path.join(here, 'listing.test.mjs'))) continue
      const text = readFileSync(file, 'utf8')
      assert.ok(!text.includes('M27.651 112.136'), `other-company logo path in ${file}`)
    }
  })
})
