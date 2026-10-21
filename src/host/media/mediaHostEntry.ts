// M105 (RVMEDIAV 8): the window's attached-media registry and its attach
// binding, dist/mediaHost.js. Required on the first attach beside
// dist/media.js, so activation carries only the registry's delegating holder
// and this bundle's loader: the registry itself, D85.7's contributor consent
// and its modal, and the binding that registers each approved file.
import * as vscode from 'vscode'
import { AttachedMedia } from '../../core/media/attachedMedia'
import { UI_TEXT, type MEDIA_CONTRIBUTOR_CHOICES } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  createMediaAttachDeps,
  createMediaSourceOpen,
  type MediaHostSettings,
  type MediaSourceOpenDeps,
} from './mediaProviders'

/** U18: the batch endpoint takes contract WAV; MP3 converts first (T9). */
const TRANSCRIBABLE_AUDIO: ReadonlySet<string> = new Set(['audio/wav', 'audio/mpeg'])

/** The window's one registry, made with its first attach. */
export function createAttachedMedia(): AttachedMedia {
  return new AttachedMedia()
}

/**
D85.7 in VS Code: a modal with Send, Use the Standard model and Remove;
dismissing it is Remove, so nothing is sent unasked.
*/
async function askContributor(question: {
  readonly title: string
  readonly detail: string
  readonly choices: typeof MEDIA_CONTRIBUTOR_CHOICES
}): Promise<(typeof MEDIA_CONTRIBUTOR_CHOICES)[number]> {
  const labels = {
    send: UI_TEXT.media.send,
    useStandard: UI_TEXT.media.useStandard,
    remove: UI_TEXT.removeAttachment,
  } as const
  const picked = await vscode.window.showWarningMessage(
    question.title,
    { modal: true, detail: question.detail },
    ...question.choices.map((choice) => labels[choice]),
  )
  return question.choices.find((choice) => labels[choice] === picked) ?? 'remove'
}

/**
The attach port's deps for one conversation: settings supply the limits,
binding registers with the window's registry, the contributor question is
the modal above, and Muse Voice transcribes WAV and MP3 while it is on.
*/
export function windowMediaAttachDeps(options: {
  readonly settings: () => MediaHostSettings
  /** The open hook's confinement and the recorder's own folder. */
  readonly open: MediaSourceOpenDeps
  readonly attached: AttachedMedia
  readonly isVoiceOn: () => boolean
  readonly table: UiText
  readonly locale: string
}) {
  setUiText(options.table, options.locale)
  return createMediaAttachDeps(options.settings, createMediaSourceOpen(options.open), {
    attached: options.attached,
    askContributor,
    transcribesSound: (info) =>
      options.settings().mediaAudioAction !== 'sendAudio' &&
      options.isVoiceOn() &&
      TRANSCRIBABLE_AUDIO.has(info.mediaType),
  })
}
