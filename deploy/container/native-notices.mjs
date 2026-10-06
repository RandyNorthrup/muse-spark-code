// Runs inside the native build stage over installed Linux npm dependencies.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = '/opt/muse/node_modules'
const packages = readdirSync(root)
  .filter((name) => !name.startsWith('.'))
  .flatMap((name) =>
    name.startsWith('@')
      ? readdirSync(path.join(root, name)).map((child) => `${name}/${child}`)
      : [name],
  )
const notices = packages
  .toSorted((a, b) => a.localeCompare(b, 'en'))
  .map((name) => {
    const directory = path.join(root, name)
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
    const licence = readdirSync(directory).find((file) =>
      /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/i.test(file),
    )
    // The exact Linux keyring binary is split from its parent npm package.
    // Its archive omits LICENSE: use the parent's MIT notice only for this
    // exact version, repository and declared licence, not arbitrary packages.
    const isSplitKeyring =
      /^@napi-rs\/keyring-linux-(?:x64|arm64)-gnu$/.test(name) &&
      manifest.version === '2.1.0' &&
      manifest.repository === 'https://github.com/Brooooooklyn/keyring-node' &&
      manifest.license === 'MIT'
    if (
      (!licence && !isSplitKeyring) ||
      !['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause'].includes(manifest.license)
    ) {
      throw new Error('Native dependency has no reviewed licence notice')
    }
    return {
      name,
      version: manifest.version,
      license: manifest.license,
      text: readFileSync(
        isSplitKeyring
          ? path.join(root, '@napi-rs/keyring/LICENSE')
          : path.join(directory, licence),
        'utf8',
      ),
    }
  })
writeFileSync('/opt/muse/native-notices.json', `${JSON.stringify(notices, null, 2)}\n`)
