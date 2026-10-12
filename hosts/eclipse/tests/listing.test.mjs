import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const eclipse = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(eclipse, '..', '..')

function read(relative) {
  return readFileSync(path.join(eclipse, relative), 'utf8')
}

function pomFiles(directory) {
  const found = []
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'target') continue
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) found.push(...pomFiles(full))
    else if (entry === 'pom.xml') found.push(full)
  }
  return found
}

function element(xml, name) {
  const match = xml.match(new RegExp(String.raw`<${name}\b([^>]*)>([\s\S]*?)</${name}>`))
  assert.ok(match, `feature.xml has no <${name}> element`)
  return { attributes: match[1], text: match[2] }
}

function urlOf(attributes, name) {
  const match = attributes.match(/\burl="([^"]*)"/)
  assert.ok(match, `<${name}> has no url attribute`)
  return match[1]
}

function decodeEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function collapse(text) {
  return decodeEntities(text).replaceAll(/\s+/g, ' ').trim()
}

const feature = read(path.join('feature', 'feature.xml'))

test('feature carries description, copyright and license before the plugin', () => {
  const description = element(feature, 'description')
  const copyright = element(feature, 'copyright')
  const license = element(feature, 'license')
  const order = [
    feature.indexOf('<description'),
    feature.indexOf('<copyright'),
    feature.indexOf('<license'),
    feature.indexOf('<plugin'),
  ]
  assert.deepEqual(
    order,
    [...order].toSorted((a, b) => a - b),
    'description, copyright and license are not in that order before <plugin>',
  )
  for (const [name, entry] of [
    ['description', description],
    ['copyright', copyright],
    ['license', license],
  ]) {
    const url = urlOf(entry.attributes, name)
    assert.ok(
      url.startsWith('https://github.com/RandyNorthrup/muse-spark-code'),
      `<${name}> url does not point at the repository: ${url}`,
    )
  }
})

test('license and copyright repeat the root LICENSE file', () => {
  const licenseText = readFileSync(path.join(root, 'LICENSE'), 'utf8')
  assert.equal(
    collapse(element(feature, 'license').text),
    collapse(licenseText),
    'license text differs from the root LICENSE file',
  )
  const copyrightLine = collapse(element(feature, 'copyright').text)
  assert.ok(
    licenseText
      .split('\n')
      .map((line) => line.trim())
      .includes(copyrightLine),
    `copyright is not a line of the root LICENSE file: ${copyrightLine}`,
  )
})

test('description names the product and its independence', () => {
  const text = element(feature, 'description').text
  assert.ok(text.includes('Unofficial'), 'description does not say Unofficial')
  assert.ok(
    text.includes('not affiliated with or endorsed by Meta'),
    'description does not disclaim Meta affiliation',
  )
})

test('host and product versions agree with the root package', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const product = pkg.version
  assert.match(product, /^\d+\.\d+\.\d+$/, `root package version is not X.Y.Z: ${product}`)
  const snapshots = []
  for (const file of pomFiles(eclipse)) {
    const xml = readFileSync(file, 'utf8')
    for (const match of xml.matchAll(/<version>([^<]*?-SNAPSHOT)<\/version>/g))
      snapshots.push(`${path.relative(eclipse, file)}: ${match[1]}`)
  }
  assert.ok(snapshots.length > 0, 'no -SNAPSHOT versions found under hosts/eclipse/**/pom.xml')
  for (const entry of snapshots) {
    assert.ok(
      entry.endsWith(`${product}-SNAPSHOT`),
      `pom version does not match the product version: ${entry}`,
    )
  }
  for (const manifest of [
    path.join('plugin', 'META-INF', 'MANIFEST.MF'),
    path.join('tests', 'META-INF', 'MANIFEST.MF'),
  ]) {
    const match = read(manifest).match(/^Bundle-Version:\s*(\S+)/m)
    assert.ok(match, `${manifest} has no Bundle-Version`)
    assert.equal(
      match[1],
      `${product}.qualifier`,
      `${manifest} version does not match the product version`,
    )
  }
  const version = feature.match(/<feature\b[^>]*\bversion="([^"]*)"/)
  assert.ok(version, 'feature.xml has no version attribute')
  assert.equal(
    version[1],
    `${product}.qualifier`,
    'feature.xml version does not match the product version',
  )
})

test('feature and plugin identities are unchanged', () => {
  const id = feature.match(/<feature\b[^>]*\bid="([^"]*)"/)
  const label = feature.match(/<feature\b[^>]*\blabel="([^"]*)"/)
  const plugin = feature.match(/<plugin\b[^>]*\bid="([^"]*)"/)
  assert.equal(id?.[1], 'io.musespark.eclipse.feature', 'feature id changed')
  assert.equal(plugin?.[1], 'io.musespark.eclipse', 'plugin id changed')
  assert.equal(label?.[1], 'Muse Spark Code (Unofficial)', 'feature label changed')
})
