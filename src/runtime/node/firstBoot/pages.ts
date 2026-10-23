// M110os OS3: the setup pages. Plain forms over POST, no script: the code
// gate, the wizard (network, disk, SSH, the sign-in and orchestrator
// notes, the Chrome and NVIDIA choices), the review with the recovery key
// shown once, and the done page. Every interpolated value is escaped;
// secrets are never echoed back, only their presence.
import { fill, formatBytes, uiLocale, UI_TEXT } from '../../../shared/l10n/text'
import type { DiskCandidate } from './disks'
import type { SetupChoices } from './schemas'
import type { SetupState } from './setupStore'

/**
Vendor terms, verified live 2026-10-23 (HTTP 200; titles in the OS7 cert
record). The URLs themselves are the link text, so no language needs a
new word for them.
*/
const CHROME_TERMS_URL = 'https://www.google.com/chrome/terms/'
const NVIDIA_LICENSE_URL = 'https://www.nvidia.com/en-us/drivers/nvidia-license/'

function termsLink(url: string): string {
  const escaped = escapeHtml(url)
  return `<a href="${escaped}">${escaped}</a>`
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

/** Escape text for HTML content and double-quoted attributes, one pass. */
export function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char)
}

function document(title: string, body: string): string {
  return (
    `<!DOCTYPE html><html lang="${escapeHtml(uiLocale())}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}` +
    `label{display:block;margin:.5rem 0}section{margin:1.5rem 0}textarea{width:100%}</style>` +
    `<title>${escapeHtml(title)}</title></head><body><main>${body}</main></body></html>`
  )
}

/** The gate: nothing but this page is served before the code. */
export function codePage(error: 'wrong' | 'used' | null): string {
  const text = UI_TEXT.nodeOs
  const alert =
    error === null
      ? ''
      : `<p role="alert">${escapeHtml(error === 'wrong' ? text.setupCodeWrong : text.setupCodeUsed)}</p>`
  return document(
    text.setupTitle,
    `<h1>${escapeHtml(text.setupTitle)}</h1><p>${escapeHtml(text.setupCodeHint)}</p>${alert}` +
      `<form method="post" action="/code"><label>${escapeHtml(text.setupCodeLabel)} ` +
      `<input name="code" autocomplete="off" required></label>` +
      `<button type="submit">${escapeHtml(text.continueButton)}</button></form>`,
  )
}

export interface WizardPrefill {
  readonly networkKind: string
  readonly ssid: string
  readonly diskTarget: string
  readonly encryption: string
  readonly sshKey: string
  readonly chrome: string
  readonly nvidia: string
}

/** Prefill a fresh wizard from the consumed seed. */
export function seedPrefill(state: SetupState): WizardPrefill {
  const network = state.seedNetwork
  return {
    networkKind: network?.kind ?? 'dhcp',
    ssid: network?.kind === 'wifi' ? network.ssid : '',
    diskTarget: '',
    encryption: 'tpm',
    sshKey: state.seedSshKeys.join('\n'),
    chrome: 'skip',
    nvidia: 'skip',
  }
}

export interface WizardInput {
  readonly state: SetupState
  readonly code: string
  readonly disks: readonly DiskCandidate[]
  /** A failed POST re-renders the wizard with its values (secrets blanked). */
  readonly prefill: WizardPrefill
  readonly sshError: boolean
  readonly formError: string | null
}

function checked(isChecked: boolean): string {
  return isChecked ? ' checked' : ''
}

/** The wizard: every choice on one page, posted to /choices. */
export function wizardPage(input: WizardInput): string {
  const text = UI_TEXT.nodeOs
  const prefill = input.prefill
  let seedNote = ''
  if (input.state.seedRefusal !== null) {
    seedNote = `<p role="alert">${escapeHtml(fill(text.seedRefused, { reason: input.state.seedRefusal }))}</p>`
  } else if (input.state.seedNetwork !== null) {
    seedNote = `<p>${escapeHtml(text.netSeedNote)}</p>`
  }
  const error =
    input.formError === null
      ? ''
      : `<p role="alert">${escapeHtml(fill(text.setupFailed, { reason: input.formError }))}</p>`
  const sshError = input.sshError ? `<p role="alert">${escapeHtml(text.sshKeyInvalid)}</p>` : ''
  const options = input.disks
    .map(
      (disk) =>
        `<option value="${escapeHtml(disk.device)}">${escapeHtml(disk.device)} — ${escapeHtml(formatBytes(disk.sizeBytes))}</option>`,
    )
    .join('')
  return document(
    text.setupTitle,
    `<h1>${escapeHtml(text.setupTitle)}</h1>${error}${seedNote}` +
      `<form method="post" action="/choices">` +
      `<input type="hidden" name="code" value="${escapeHtml(input.code)}">` +
      `<section><h2>${escapeHtml(text.netTitle)}</h2>` +
      `<p>${escapeHtml(text.netConsoleNote)}</p>` +
      `<label><input type="radio" name="networkKind" value="dhcp"${checked(prefill.networkKind !== 'wifi')}> ` +
      `${escapeHtml(text.netDhcp)}</label>` +
      `<label><input type="radio" name="networkKind" value="wifi"${checked(prefill.networkKind === 'wifi')}> ` +
      `${escapeHtml(text.netWifi)}</label>` +
      `<label>${escapeHtml(text.netSsid)} <input name="ssid" value="${escapeHtml(prefill.ssid)}"></label>` +
      `<label>${escapeHtml(text.netPassword)} <input name="psk" type="password" autocomplete="off"></label></section>` +
      `<section><h2>${escapeHtml(text.diskTitle)}</h2>` +
      `<label>${escapeHtml(text.diskTarget)} ` +
      `<input name="diskTarget" list="disks" value="${escapeHtml(prefill.diskTarget)}" required></label>` +
      `<datalist id="disks">${options}</datalist>` +
      `<label><input type="radio" name="encryption" value="tpm"${checked(prefill.encryption !== 'passphrase' && prefill.encryption !== 'none')}> ` +
      `${escapeHtml(text.diskEncryptTpm)}</label>` +
      `<label><input type="radio" name="encryption" value="passphrase"${checked(prefill.encryption === 'passphrase')}> ` +
      `${escapeHtml(text.diskEncryptPassphrase)}</label>` +
      `<label><input type="radio" name="encryption" value="none"${checked(prefill.encryption === 'none')}> ` +
      `${escapeHtml(text.diskEncryptNone)}</label>` +
      `<p>${escapeHtml(text.diskNoEncryptWarning)}</p>` +
      `<label>${escapeHtml(text.diskTpmPin)} <input name="tpmPin" type="password" autocomplete="off"></label>` +
      `<p>${escapeHtml(text.diskTangNote)}</p></section>` +
      `<section><h2>${escapeHtml(text.sshTitle)}</h2>${sshError}` +
      `<p>${escapeHtml(text.sshOffNote)}</p>` +
      `<label>${escapeHtml(text.sshKeyLabel)}<textarea name="sshKey" rows="3" spellcheck="false">${escapeHtml(prefill.sshKey)}</textarea></label></section>` +
      `<section><h2>${escapeHtml(text.signinTitle)}</h2><p>${escapeHtml(text.signinPasskeyNote)}</p></section>` +
      `<section><h2>${escapeHtml(text.orchestratorTitle)}</h2><p>${escapeHtml(text.orchestratorWaiting)}</p></section>` +
      `<section><h2>${escapeHtml(text.chromeTitle)}</h2><p>${escapeHtml(text.chromeTerms)} ${termsLink(CHROME_TERMS_URL)}</p>` +
      `<p>${escapeHtml(text.chromeFallback)}</p>` +
      `<label><input type="radio" name="chrome" value="install"${checked(prefill.chrome === 'install')}> ` +
      `${escapeHtml(text.chromeAccept)}</label>` +
      `<label><input type="radio" name="chrome" value="skip"${checked(prefill.chrome !== 'install')}> ` +
      `${escapeHtml(text.skipStep)}</label></section>` +
      `<section><h2>${escapeHtml(text.nvidiaTitle)}</h2><p>${escapeHtml(text.nvidiaTerms)} ${termsLink(NVIDIA_LICENSE_URL)}</p>` +
      `<p>${escapeHtml(text.nvidiaDatacenter)}</p>` +
      `<label><input type="radio" name="nvidia" value="install"${checked(prefill.nvidia === 'install')}> ` +
      `${escapeHtml(text.nvidiaAccept)}</label>` +
      `<label><input type="radio" name="nvidia" value="skip"${checked(prefill.nvidia !== 'install')}> ` +
      `${escapeHtml(text.skipStep)}</label></section>` +
      `<button type="submit">${escapeHtml(text.continueButton)}</button></form>`,
  )
}

export interface ReviewInput {
  readonly code: string
  readonly choices: SetupChoices
  readonly tpmPinSet: boolean
  readonly pskSet: boolean
  readonly recoveryKey: string
}

const MASKED_VALUE = '••••'

/**
The review: every choice back, secrets masked, and the recovery key shown
once. The done page never shows the key again.
*/
export function reviewPage(input: ReviewInput): string {
  const text = UI_TEXT.nodeOs
  const network =
    input.choices.network.kind === 'wifi'
      ? `${text.netWifi}: ${input.choices.network.ssid} (${text.netPassword}: ${input.pskSet ? MASKED_VALUE : text.skipStep})`
      : text.netDhcp
  const encryptionLabels = {
    tpm: text.diskEncryptTpm,
    passphrase: text.diskEncryptPassphrase,
    none: text.diskEncryptNone,
  } as const
  const encryption = encryptionLabels[input.choices.disk.encryption]
  const chrome = input.choices.chrome === 'install' ? text.chromeAccept : text.skipStep
  const nvidia = input.choices.nvidia === 'install' ? text.nvidiaAccept : text.skipStep
  const sshLines = input.choices.sshKey
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const ssh =
    sshLines.length === 0 ? text.sshOffNote : sshLines.map((line) => escapeHtml(line)).join('<br>')
  return document(
    text.summaryTitle,
    `<h1>${escapeHtml(text.summaryTitle)}</h1>` +
      `<dl><dt>${escapeHtml(text.netTitle)}</dt><dd>${escapeHtml(network)}</dd>` +
      `<dt>${escapeHtml(text.diskTitle)}</dt><dd>${escapeHtml(input.choices.disk.target)}</dd>` +
      `<dt>${escapeHtml(text.diskTpmPin)}</dt><dd>${escapeHtml(input.tpmPinSet ? MASKED_VALUE : text.skipStep)}</dd>` +
      `<dt>${escapeHtml(text.sshTitle)}</dt><dd>${ssh}</dd>` +
      `<dt>${escapeHtml(text.chromeTitle)}</dt><dd>${escapeHtml(chrome)}</dd>` +
      `<dt>${escapeHtml(text.nvidiaTitle)}</dt><dd>${escapeHtml(nvidia)}</dd></dl>` +
      `<p>${escapeHtml(encryption)}</p>` +
      `<section><h2>${escapeHtml(text.recoveryKeyTitle)}</h2>` +
      `<p>${escapeHtml(text.recoveryKeyWarning)}</p><pre>${escapeHtml(input.recoveryKey)}</pre></section>` +
      `<form method="post" action="/complete">` +
      `<input type="hidden" name="code" value="${escapeHtml(input.code)}">` +
      `<button type="submit">${escapeHtml(text.continueButton)}</button></form>`,
  )
}

/** The done page: setup is complete and the code is dead. */
export function donePage(): string {
  const text = UI_TEXT.nodeOs
  return document(
    text.setupTitle,
    `<h1>${escapeHtml(text.setupTitle)}</h1><p>${escapeHtml(text.setupDone)}</p>`,
  )
}

/** A refusal: a stable technical reason inside the setup's sentence. */
export function failedPage(reason: string): string {
  const text = UI_TEXT.nodeOs
  return document(
    text.setupTitle,
    `<h1>${escapeHtml(text.setupTitle)}</h1><p role="alert">${escapeHtml(fill(text.setupFailed, { reason }))}</p>`,
  )
}
