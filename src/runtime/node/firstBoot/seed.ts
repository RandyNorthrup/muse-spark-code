// M110os OS3: the cloud-init seed on the boot partition. The same
// `network-config` and `user-data` files Raspberry Pi Imager writes for
// Raspberry Pi OS on trixie (v2 netplan; `#cloud-config`), read once and
// then deleted. Anything the setup cannot use is refused with a stable
// code the setup page shows (the files are kept for the operator to fix);
// anything valid but unneeded is reported as ignored, never silently
// dropped. Contracts fetched 2026-10-23:
// https://www.raspberrypi.com/news/cloud-init-on-raspberry-pi-os/
// https://docs.cloud-init.io/en/latest/reference/network-config-format-v2.html
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseSshPublicKey, setupHostnameSchema, type SetupNetwork } from './schemas'

/** Stable refusal codes: technical detail the setup page splices, never prose. */
export type SeedRefusalCode =
  | 'seed-network-unreadable'
  | 'seed-network-invalid'
  | 'seed-network-version'
  | 'seed-network-static'
  | 'seed-wifi-password'
  | 'seed-userdata-unreadable'
  | 'seed-userdata-invalid'
  | 'seed-userdata-header'
  | 'seed-hostname-invalid'
  | 'seed-ssh-invalid'

export interface SeedNetwork {
  /** Null when the seed configures no network: setup falls back to DHCP. */
  readonly network: SetupNetwork | null
  /** Valid seed content the setup does not use, by dotted path. */
  readonly ignored: readonly string[]
}

export interface SeedUserData {
  readonly hostname: string | undefined
  readonly sshKeys: readonly string[]
  readonly ignored: readonly string[]
}

export type SeedOutcome =
  | { readonly ok: true; readonly network: SeedNetwork; readonly user: SeedUserData }
  | { readonly ok: false; readonly code: SeedRefusalCode }

/** A refused seed: the setup continues without it and says the code. */
export class SeedFailure extends Error {
  readonly code: SeedRefusalCode
  constructor(code: SeedRefusalCode, options?: ErrorOptions) {
    super(code, options)
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** cloud-init reads YAML 1.1 (`yes` is true); accept what it would accept. */
function isTruthy(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    (typeof value === 'string' && ['yes', 'true', '1'].includes(value.toLowerCase()))
  )
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function readSeedFile(dir: string, name: string, unreadable: SeedRefusalCode): string | undefined {
  try {
    return readFileSync(path.join(dir, name), 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw new SeedFailure(unreadable, { cause: error })
  }
}

function parseNetworkDoc(text: string): SeedNetwork {
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (error: unknown) {
    throw new SeedFailure('seed-network-invalid', { cause: error })
  }
  // An empty file configures nothing: like cloud-init, fall back to DHCP.
  if (doc === null || doc === undefined) return { network: null, ignored: [] }
  if (!isRecord(doc)) throw new SeedFailure('seed-network-invalid')
  // The `network:` wrapper lives in cloud.cfg; the raw file may carry it or not.
  const network: unknown = 'network' in doc ? doc['network'] : doc
  if (!isRecord(network)) throw new SeedFailure('seed-network-invalid')
  if (network['version'] !== 2) throw new SeedFailure('seed-network-version')
  const ignored: string[] = []
  for (const key of Object.keys(network)) {
    if (key !== 'version' && key !== 'ethernets' && key !== 'wifis') ignored.push(key)
  }
  const ethernets = network['ethernets']
  if (ethernets !== undefined && !isRecord(ethernets)) throw new SeedFailure('seed-network-invalid')
  const wifis = network['wifis']
  if (wifis !== undefined && !isRecord(wifis)) throw new SeedFailure('seed-network-invalid')

  let hasDhcp = false
  let isStaticOnly = false
  if (ethernets !== undefined) {
    for (const [id, def] of Object.entries(ethernets)) {
      if (!isRecord(def)) throw new SeedFailure('seed-network-invalid')
      for (const key of Object.keys(def)) {
        if (key !== 'dhcp4' && key !== 'dhcp6' && key !== 'addresses') ignored.push(`${id}.${key}`)
      }
      if (isTruthy(def['dhcp4'])) hasDhcp = true
      else if (def['addresses'] !== undefined) isStaticOnly = true
    }
  }
  if (hasDhcp) return { network: { kind: 'dhcp' }, ignored }

  if (wifis !== undefined) {
    for (const [id, def] of Object.entries(wifis)) {
      if (!isRecord(def)) throw new SeedFailure('seed-network-invalid')
      for (const key of Object.keys(def)) {
        if (key !== 'access-points' && key !== 'dhcp4') ignored.push(`${id}.${key}`)
      }
      const points = def['access-points']
      if (points === undefined) continue
      if (!isRecord(points)) throw new SeedFailure('seed-network-invalid')
      const entries = Object.entries(points)
      const first = entries[0]
      if (first === undefined) continue
      const [ssid, ap] = first
      const later = entries.slice(1)
      for (const [other] of later) ignored.push(`${id}.${other}`)
      if (!isRecord(ap)) throw new SeedFailure('seed-network-invalid')
      const password = ap['password']
      if (password !== undefined && typeof password !== 'string') {
        throw new SeedFailure('seed-wifi-password')
      }
      const network: SetupNetwork =
        password === undefined ? { kind: 'wifi', ssid } : { kind: 'wifi', ssid, psk: password }
      return { network, ignored }
    }
  }
  if (isStaticOnly) throw new SeedFailure('seed-network-static')
  return { network: null, ignored }
}

function sshKeyList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const keys: string[] = []
  for (const key of value) {
    if (typeof key !== 'string' || parseSshPublicKey(key) === undefined) return undefined
    keys.push(key)
  }
  return keys
}

function parseUserDoc(text: string): SeedUserData {
  const firstLine = text.split('\n', 1)[0]?.trim()
  if (firstLine !== '#cloud-config') throw new SeedFailure('seed-userdata-header')
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (error: unknown) {
    throw new SeedFailure('seed-userdata-invalid', { cause: error })
  }
  if (!isRecord(doc)) throw new SeedFailure('seed-userdata-invalid')
  const ignored: string[] = []
  let hostname: string | undefined
  if (doc['hostname'] !== undefined) {
    const checked = setupHostnameSchema.safeParse(doc['hostname'])
    if (!checked.success) throw new SeedFailure('seed-hostname-invalid')
    hostname = checked.data
  }
  const sshKeys: string[] = []
  if (doc['ssh_authorized_keys'] !== undefined) {
    const keys = sshKeyList(doc['ssh_authorized_keys'])
    if (keys === undefined) throw new SeedFailure('seed-ssh-invalid')
    sshKeys.push(...keys)
  }
  if (doc['users'] !== undefined) {
    // Accounts are the image's own; only their keys are taken.
    ignored.push('users')
    const users = doc['users']
    if (!Array.isArray(users)) throw new SeedFailure('seed-userdata-invalid')
    for (const user of users) {
      if (!isRecord(user)) throw new SeedFailure('seed-userdata-invalid')
      if (user['ssh_authorized_keys'] === undefined) continue
      const keys = sshKeyList(user['ssh_authorized_keys'])
      if (keys === undefined) throw new SeedFailure('seed-ssh-invalid')
      sshKeys.push(...keys)
    }
  }
  for (const key of Object.keys(doc)) {
    if (key !== 'hostname' && key !== 'ssh_authorized_keys' && key !== 'users') ignored.push(key)
  }
  return { hostname, sshKeys, ignored }
}

/**
Read the seed and delete it. Both files must be acceptable before any is
removed; a refusal keeps every file for the operator to fix. Setup
continues without the seed either way: the refusal code is the page's
note, never a stop.
*/
export function readAndConsumeSeed(bootDir: string): SeedOutcome {
  try {
    return readSeed(bootDir)
  } catch (error: unknown) {
    if (error instanceof SeedFailure) return { ok: false, code: error.code }
    throw error
  }
}

function readSeed(bootDir: string): Extract<SeedOutcome, { ok: true }> {
  const networkText = readSeedFile(bootDir, 'network-config', 'seed-network-unreadable')
  const userText = readSeedFile(bootDir, 'user-data', 'seed-userdata-unreadable')
  const network =
    networkText === undefined ? { network: null, ignored: [] } : parseNetworkDoc(networkText)
  const user =
    userText === undefined
      ? { hostname: undefined, sshKeys: [], ignored: [] }
      : parseUserDoc(userText)
  for (const name of ['network-config', 'user-data', 'meta-data']) {
    rmSync(path.join(bootDir, name), { force: true })
  }
  return { ok: true, network, user }
}
