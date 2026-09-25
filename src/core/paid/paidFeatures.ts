// The paid Model API features (M33–M35, PLAN.md D30), "opt in and loud":
// which are on, and what this window has used of them.
//
// A feature is on only when its setting is on AND the user accepted its
// price in the confirmation. Turning the setting on anywhere (the palette,
// the Settings editor, settings.json) asks once, naming the price; a
// declined confirmation turns the setting back off, and turning the setting
// off forgets the acceptance, so the next time asks again. The confirmation
// is asked by the focused window only; another window asks when it is
// focused, if the answer has not reached it by then.
//
// No `vscode` here: the host injects the settings, the store, the modal and
// the window focus.

import { PAID_FEATURES, type PaidFeature } from '../../shared/constants'
import { EMPTY_PAID_TALLY, type PaidState, type PaidTally } from '../../shared/paid'
import type { CoreLogger } from '../logging'

export interface PaidFeatureGateDeps {
  /** Whether the feature's `museSpark.*` setting is on. */
  readonly isSettingOn: (feature: PaidFeature) => boolean
  /** Writes the feature's setting in the user's settings. */
  readonly setSetting: (feature: PaidFeature, isOn: boolean) => Promise<void>
  /** The features whose price the user accepted (the extension's own global state). */
  readonly readAccepted: () => ReadonlySet<PaidFeature>
  readonly writeAccepted: (accepted: ReadonlySet<PaidFeature>) => Promise<void>
  /** The modal naming the price; true when the user turned the feature on. */
  readonly confirm: (feature: PaidFeature) => Promise<boolean>
  readonly isWindowFocused: () => boolean
  readonly log: CoreLogger
}

export class PaidFeatureGate {
  /** Features whose confirmation is on screen now: never asked twice at once. */
  private readonly asking = new Set<PaidFeature>()
  private readonly listeners = new Set<() => void>()

  public constructor(private readonly deps: PaidFeatureGateDeps) {}

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private async setAccepted(feature: PaidFeature, isAccepted: boolean): Promise<void> {
    const accepted = new Set(this.deps.readAccepted())
    if (accepted.has(feature) === isAccepted) {
      return
    }
    if (isAccepted) {
      accepted.add(feature)
    } else {
      accepted.delete(feature)
    }
    await this.deps.writeAccepted(accepted)
  }

  /** The confirmation for a setting found on without an accepted price. */
  private async askFor(feature: PaidFeature): Promise<void> {
    this.asking.add(feature)
    let isConfirmed: boolean
    try {
      isConfirmed = await this.deps.confirm(feature)
    } finally {
      this.asking.delete(feature)
    }
    // The setting may have been turned off while the modal was open.
    if (isConfirmed && this.deps.isSettingOn(feature)) {
      await this.setAccepted(feature, true)
      this.deps.log.info(`Paid feature ${feature} turned on; the user accepted its price`)
    } else {
      this.deps.log.info(`Paid feature ${feature} left off; its price was not accepted`)
      await this.deps.setSetting(feature, false)
    }
    this.notify()
  }

  /** Whether the feature may be used: setting on and price accepted. */
  public isOn(feature: PaidFeature): boolean {
    return this.deps.isSettingOn(feature) && this.deps.readAccepted().has(feature)
  }

  /** The features that are on, in their fixed order. */
  public features(): readonly PaidFeature[] {
    return PAID_FEATURES.filter((feature) => this.isOn(feature))
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Brings the acceptances in line with the settings: a setting turned off
   * forgets its acceptance, and one found on without an acceptance asks
   * (in the focused window). Run at activation, on every settings change and
   * when the window gains focus.
   */
  public async review(): Promise<void> {
    const pending: PaidFeature[] = []
    for (const feature of PAID_FEATURES) {
      const isSettingOn = this.deps.isSettingOn(feature)
      const isAccepted = this.deps.readAccepted().has(feature)
      if (!isSettingOn && isAccepted) {
        await this.setAccepted(feature, false)
        this.deps.log.info(`Paid feature ${feature} turned off`)
      } else if (isSettingOn && !isAccepted && !this.asking.has(feature)) {
        pending.push(feature)
      }
    }
    this.notify()
    if (!this.deps.isWindowFocused()) {
      return
    }
    // One modal at a time, in the features' order.
    for (const feature of pending) {
      await this.askFor(feature)
    }
  }

  /** The palette's toggle turning a feature on: the confirmation first, then the setting. */
  public async turnOn(feature: PaidFeature): Promise<boolean> {
    if (this.isOn(feature)) {
      return true
    }
    if (this.asking.has(feature)) {
      return false
    }
    this.asking.add(feature)
    let isConfirmed: boolean
    try {
      isConfirmed = await this.deps.confirm(feature)
    } finally {
      this.asking.delete(feature)
    }
    if (!isConfirmed) {
      this.deps.log.info(`Paid feature ${feature} left off; its price was not accepted`)
      return false
    }
    // Accepted before the setting changes, so the change asks nothing more.
    await this.setAccepted(feature, true)
    await this.deps.setSetting(feature, true)
    this.deps.log.info(`Paid feature ${feature} turned on; the user accepted its price`)
    this.notify()
    return true
  }

  public async turnOff(feature: PaidFeature): Promise<void> {
    await this.deps.setSetting(feature, false)
    await this.setAccepted(feature, false)
    this.deps.log.info(`Paid feature ${feature} turned off`)
    this.notify()
  }
}

/** What this window used of each paid feature since it opened (the usage dialog's tally). */
export class PaidUsage {
  private tally: PaidTally = EMPTY_PAID_TALLY
  private readonly listeners = new Set<() => void>()

  public constructor(private readonly log: CoreLogger) {}

  public get current(): PaidTally {
    return this.tally
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Counts `units` uses: searches, images, or whole seconds of audio. */
  public add(feature: PaidFeature, units: number): void {
    if (units <= 0) {
      return
    }
    const { tally } = this
    switch (feature) {
      case 'webSearch': {
        this.tally = { ...tally, webSearches: tally.webSearches + units }
        break
      }
      case 'imageGeneration': {
        this.tally = { ...tally, images: tally.images + units }
        break
      }
      case 'voice': {
        this.tally = { ...tally, voiceSeconds: tally.voiceSeconds + units }
        break
      }
    }
    this.log.info(`Paid use: ${feature} +${String(units)}`)
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** The message the panels render the badge, the microphone and the tally from. */
export function paidStateOf(
  gate: PaidFeatureGate,
  usage: PaidUsage,
  isKeyStored: boolean,
): PaidState {
  return { features: [...gate.features()], tally: usage.current, isKeyStored }
}
