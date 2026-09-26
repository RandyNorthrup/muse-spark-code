// The VS Code forks' checks (forks.yml, PLAN.md M62b), two commands:
//
//   node test/hosts/fork-release.mjs latest cursor|devin-desktop|kiro|positron
//     prints "<version> <download URL>" for the fork's latest Linux x64
//     release, from the feed its nixpkgs update script or Homebrew cask
//     reads (Devin Desktop was Windsurf until 2026)
//   node test/hosts/fork-release.mjs describe <app folder>
//     prints the unpacked app's executable name, then a line naming the
//     fork's version and the VS Code version it is built on

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}`)
  }
  return response.json()
}

/** The field a feed must carry; its keys are named when it does not. */
function field(json, key, feed) {
  const value = json[key]
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${feed} has no "${key}"; its keys: ${Object.keys(json).join(', ')}`)
  }
  return value
}

const GITHUB_TOKEN = process.env.GH_TOKEN

const FEEDS = {
  async cursor() {
    const feed = 'https://api2.cursor.sh/updates/api/download/stable/linux-x64/cursor'
    const json = await getJson(feed)
    return { version: field(json, 'version', feed), url: field(json, 'downloadUrl', feed) }
  },
  async 'devin-desktop'() {
    const feed = 'https://windsurf-stable.codeium.com/api/update/linux-x64/stable/latest'
    const json = await getJson(feed)
    return { version: field(json, 'windsurfVersion', feed), url: field(json, 'url', feed) }
  },
  async kiro() {
    const feed = 'https://prod.download.desktop.kiro.dev/stable/metadata-linux-x64-stable.json'
    const json = await getJson(feed)
    const archive = (json.releases ?? [])
      .map((release) => release.updateTo)
      .find((update) => /\.tar(?:\.|$)/.test(update?.url ?? ''))
    if (archive === undefined) {
      throw new Error(`${feed} lists no .tar release`)
    }
    return { version: field(json, 'currentRelease', feed), url: archive.url }
  },
  async positron() {
    const feed = 'https://api.github.com/repos/posit-dev/positron/releases?per_page=1'
    const headers = GITHUB_TOKEN === undefined ? {} : { authorization: `Bearer ${GITHUB_TOKEN}` }
    const [latest] = await getJson(feed, headers)
    const version = field(latest ?? {}, 'tag_name', feed)
    return {
      version,
      url: `https://cdn.posit.co/positron/releases/deb/x86_64/Positron-${version}-x64.deb`,
    }
  },
}

async function latest(fork) {
  const find = Object.hasOwn(FEEDS, fork) ? FEEDS[fork] : undefined
  if (find === undefined) {
    throw new Error(`no feed for "${fork}"; one of: ${Object.keys(FEEDS).join(', ')}`)
  }
  const { version, url } = await find()
  console.log(`${version} ${url}`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** A VS Code release number: 1, then a minor of two digits or more (1.99.3, 1.128.0). */
const VSCODE_VERSION = /^1\.\d{2,}\.\d+$/

function describe(root) {
  const app = path.join(root, 'resources', 'app')
  const product = readJson(path.join(app, 'product.json'))
  const manifest = readJson(path.join(app, 'package.json'))
  // Cursor names its VS Code base apart (vscodeVersion); Devin Desktop and
  // Positron keep VS Code's as the product's and their own under a name of
  // their own; a fork numbered in its own right (Kiro) may name it nowhere.
  const vscode = [product.vscodeVersion, product.version, manifest.version].find(
    (value) => typeof value === 'string' && VSCODE_VERSION.test(value),
  )
  const own = [
    ...new Set([product.version, product.windsurfVersion, product.positronVersion]),
  ].filter((value) => typeof value === 'string' && value !== vscode)
  const fields = Object.entries(product)
    .filter(([key, value]) => /version/i.test(key) && typeof value === 'string')
    .map(([key, value]) => `${key} ${value}`)
    .join(', ')
  const base =
    vscode === undefined
      ? `VS Code version not named; product.json has ${fields}`
      : `VS Code ${vscode}`
  console.log(product.applicationName)
  console.log(`${[product.nameLong, ...own].join(' ')} (${base})`)
}

const [command, argument] = process.argv.slice(2)
if (command === 'latest' && argument !== undefined) {
  await latest(argument)
} else if (command === 'describe' && argument !== undefined) {
  describe(argument)
} else {
  throw new Error('usage: fork-release.mjs latest <fork> | describe <app folder>')
}
