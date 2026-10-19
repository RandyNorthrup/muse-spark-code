// M105 C / D85.7: the contributor tier's ask-once question for video, audio
// and screen recordings. Light on purpose: the attach port's first-use
// bundle (dist/media.js) carries it without the estimator or its schemas.
import * as z from 'zod/mini'
import { MEDIA_CONTRIBUTOR_CHOICES, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { MediaInfo } from '../../shared/media'

/** Every editor asks through its own modal/permission bridge, before upload. */
export class MediaContributorConsent {
  private readonly allowed = new Set<string>()
  private readonly pending = new Map<string, Promise<'send' | 'useStandard' | 'remove'>>()

  public constructor(
    private readonly ask: (question: {
      readonly title: string
      readonly detail: string
      readonly choices: typeof MEDIA_CONTRIBUTOR_CHOICES
    }) => Promise<'send' | 'useStandard' | 'remove'>,
  ) {}

  public async choose(request: {
    readonly conversationId: string
    readonly name: string
    readonly info: MediaInfo
    readonly contributor: boolean
    readonly isScreenRecording: boolean
  }) {
    const isSensitive = ['video', 'audio'].includes(request.info.kind)
    if (
      !request.isScreenRecording &&
      (!isSensitive || !request.contributor || this.allowed.has(request.conversationId))
    )
      return 'send'
    const decide = async () => {
      const choice = z.enum(MEDIA_CONTRIBUTOR_CHOICES).parse(
        await this.ask({
          title: request.contributor
            ? fill(UI_TEXT.media.contributorQuestion, { name: request.name })
            : UI_TEXT.media.recordingWarning,
          detail: request.isScreenRecording
            ? UI_TEXT.media.recordingWarning
            : UI_TEXT.media.contributorWarning,
          choices: MEDIA_CONTRIBUTOR_CHOICES,
        }),
      )
      if (choice === 'send' && request.contributor) this.allowed.add(request.conversationId)
      return choice
    }
    if (request.isScreenRecording) return await decide()
    const pending = this.pending.get(request.conversationId)
    if (pending !== undefined) return await pending
    const decision = decide()
    this.pending.set(request.conversationId, decision)
    try {
      return await decision
    } finally {
      this.pending.delete(request.conversationId)
    }
  }
}
