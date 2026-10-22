import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const normalize = (file) => file.replaceAll('\\', '/')
const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
])

export function checkNodeAuthArtifact(artifact, sizeKiB, inputs) {
  if (sizeKiB > artifact.budgetKiB)
    throw new Error(
      `${artifact.output} exceeds ${artifact.budgetKiB} KiB: ${sizeKiB.toFixed(1)} KiB`,
    )
  if (
    artifact.platform === 'browser' &&
    inputs.some(
      (file) =>
        normalize(file).includes('@simplewebauthn/server/') ||
        normalize(file).startsWith('src/runtime/'),
    )
  )
    throw new Error('Server code reached the browser sign-in page')
}

export function checkNodeAuthSplit(inputs, label) {
  if (
    inputs.some((file) => /src\/(?:runtime|webview)\/node\/(?:auth|tls)\//u.test(normalize(file)))
  )
    throw new Error(`A1 lazy code reached ${label}`)
}

/** Notices follow actual bundled inputs, including scratch installs; no dependency tree is modified. */
export async function nodeAuthNotices(metafiles) {
  const directories = new Set()
  for (const meta of metafiles) {
    for (const output of Object.values(meta.outputs)) {
      for (const input of Object.keys(output.inputs)) {
        const file = normalize(input)
        const marker = 'node_modules/'
        const at = file.lastIndexOf(marker)
        if (at === -1) continue
        const start = at + marker.length
        const parts = file.slice(start).split('/')
        const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
        directories.add(file.slice(0, start) + name)
      }
    }
  }
  const notices = []
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    if (!ALLOWED_LICENSES.has(manifest.license))
      throw new Error(`Unapproved bundled license: ${manifest.name}`)
    const entries = await readdir(directory)
    const files = entries.filter((file) =>
      /^(?:licen[cs]e|copying|notice)(?:\.(?:md|txt|markdown))?$/iu.test(file),
    )
    if (files.every((file) => !/^(?:licen[cs]e|copying)/iu.test(file)))
      throw new Error(`Missing bundled license: ${manifest.name}`)
    const texts = await Promise.all(
      files.map((file) => readFile(path.join(directory, file), 'utf8')),
    )
    notices.push({
      name: manifest.name,
      text: `${manifest.name} (${manifest.license})\n${texts.join('\n\n').replaceAll('\r\n', '\n').trim()}`,
    })
  }
  notices.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return `THIRD-PARTY SOFTWARE NOTICES\nMuse Spark Code (Unofficial)\nA1 nodeAuth.js and nodeAuthPage.js\n\n${notices.map((notice) => notice.text).join('\n\n')}\n`
}
