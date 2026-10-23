import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { pluginIconFrom } from '../make-plugin-icon.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)
const jetbrains = path.resolve(here, '..')
const root = path.resolve(jetbrains, '..', '..')
const metaInf = path.join(jetbrains, 'src', 'main', 'resources', 'META-INF')

function read(relative) {
  return readFileSync(path.join(jetbrains, relative), 'utf8').replaceAll('\r\n', '\n')
}

const pluginXml = read(path.join('src', 'main', 'resources', 'META-INF', 'plugin.xml'))
const gradle = read('build.gradle.kts')
const logo = read(path.join('src', 'main', 'resources', 'META-INF', 'pluginIcon.svg'))

function element(name) {
  const match = new RegExp(String.raw`<${name}>([\s\S]*?)</${name}>`, 'u').exec(pluginXml)
  assert.ok(match, `plugin.xml has no <${name}>`)
  return match[1]
}

function cdata(name) {
  const raw = element(name)
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/u.exec(raw.trim())
  assert.ok(match, `<${name}> is not CDATA`)
  return match[1]
}

test('logo is the generated 40 by 40 px product mark, not another logo', () => {
  assert.ok(
    statSync(path.join(metaInf, 'pluginIcon.svg')).isFile(),
    'META-INF/pluginIcon.svg exists',
  )
  const source = readFileSync(path.join(root, 'media', 'marketplace-icon.svg'), 'utf8')
  assert.equal(logo, pluginIconFrom(source))
  assert.match(logo, /<svg[^>]*width="40"[^>]*height="40"/u)
  for (const forbidden of ['<image', '<text', '<script', '<foreignObject', 'href=', 'url(http']) {
    assert.ok(!logo.includes(forbidden), `logo contains ${forbidden}`)
  }
  assert.ok(
    Buffer.byteLength(logo) < 4096,
    `logo is ${String(Buffer.byteLength(logo))} bytes, over 4,096`,
  )
  const queue = [path.join(jetbrains, 'src', 'main', 'resources')]
  while (queue.length > 0) {
    const entry = queue.pop()
    assert.ok(entry !== undefined)
    for (const name of readdirSync(entry)) {
      const full = path.join(entry, name)
      if (statSync(full).isDirectory()) {
        queue.push(full)
      } else {
        assert.ok(
          !readFileSync(full, 'utf8').includes('M27.651 112.136'),
          `${path.relative(jetbrains, full)} carries the other logo path`,
        )
      }
    }
  }
})

test('name is one value in both places and fits the Marketplace rules', () => {
  const xmlName = element('name').trim()
  const gradleName = /name\s*=\s*"([^"]+)"/u.exec(gradle)?.[1]
  assert.ok(gradleName !== undefined, 'build.gradle.kts has no pluginConfiguration name')
  assert.equal(xmlName, gradleName)
  assert.ok(xmlName.length <= 30, `name is ${String(xmlName.length)} characters, over 30`)
  assert.match(xmlName, /^[A-Za-z0-9 .()-]+$/u)
  const lowered = xmlName.toLowerCase()
  for (const word of [
    'plugin',
    'intellij',
    'jetbrains',
    'idea',
    'pycharm',
    'webstorm',
    'phpstorm',
    'rider',
    'clion',
    'goland',
    'rubymine',
    'datagrip',
    'rustrover',
    'dataspell',
    'android studio',
    'fleet',
    'aqua',
  ]) {
    assert.ok(!lowered.includes(word), `name contains ${word}`)
  }
})

test('description names the project honestly and links only home', () => {
  const description = cdata('description')
  assert.ok(description.includes('Unofficial'))
  assert.ok(description.includes('not affiliated with or endorsed by Meta'))
  const hrefs = description
    .matchAll(/href="([^"]*)"/gu)
    .map((match) => match[1])
    .toArray()
  assert.ok(hrefs.length > 0, 'description has no link')
  for (const href of hrefs) {
    assert.equal(href, 'https://github.com/RandyNorthrup/muse-spark-code')
  }
  for (const stub of ['TODO', 'TBD', 'lorem', 'Add change notes here']) {
    assert.ok(!description.includes(stub), `description contains ${stub}`)
  }
})

test('change notes are present, real notes, and not the template text', () => {
  const notes = cdata('change-notes')
  assert.ok(notes.trim().length > 0, 'change notes are empty')
  assert.ok(!notes.includes('Add change notes here'))
  assert.ok(!notes.includes('most HTML tags may be used'))
})

test('version comes from the repository package.json, not a pinned literal', () => {
  const pinned = gradle.split('\n').filter((line) => /^version\s*=\s*"/u.test(line))
  assert.deepEqual(pinned, [])
  assert.ok(gradle.includes('package.json'), 'version expression names no package.json')
  const configured = /"version"\s*:\s*"([^"]+)"/u.exec(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  )?.[1]
  assert.ok(configured !== undefined && configured.length > 0, 'package.json has no version')
  assert.ok(
    pathToFileURL(path.join(root, 'package.json')).href.endsWith('/package.json'),
    'version source resolves oddly',
  )
})
