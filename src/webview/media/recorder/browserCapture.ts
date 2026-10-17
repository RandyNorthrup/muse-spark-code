import { UI_TEXT } from '../../../shared/constants'
import type { BrowserRecordingPort } from './browserRecorder'

// Older companion browsers omit this otherwise-required DOM property.
function mediaDevices(): MediaDevices | undefined {
  return navigator.mediaDevices
}

/** Created only in the companion's lazy UI; constructing it never captures. */
export function companionBrowserPort(
  browser: string,
  attach: BrowserRecordingPort['attach'],
): BrowserRecordingPort {
  return {
    browser,
    supportsMp4: () => {
      const devices = mediaDevices()
      return (
        typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported('video/mp4') &&
        devices !== undefined &&
        typeof devices.getDisplayMedia === 'function'
      )
    },
    objectUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => {
      URL.revokeObjectURL(url)
    },
    attach,
    async capture(options, signal) {
      if (signal.aborted) throw new Error(UI_TEXT.media.recordingPermissionDenied)
      // getDisplayMedia enforces transient user activation and its own picker.
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: options.systemAudio,
      })
      let microphone: MediaStream | undefined
      let mixer: AudioContext | undefined
      const mixedTracks: MediaStreamTrack[] = []
      const release = () => {
        signal.removeEventListener('abort', release)
        for (const track of [
          ...screen.getTracks(),
          ...(microphone?.getTracks() ?? []),
          ...mixedTracks,
        ])
          track.stop()
        if (mixer !== undefined && mixer.state !== 'closed')
          void mixer.close().catch(() => {
            /* Capture tracks are already stopped. */
          })
      }
      signal.addEventListener('abort', release, { once: true })
      const ensureActive = () => {
        if (signal.aborted) throw new Error(UI_TEXT.media.recordingPermissionDenied)
      }
      try {
        ensureActive()
        if (options.systemAudio && screen.getAudioTracks().length === 0)
          throw new Error(UI_TEXT.media.recordingPermissionDenied)
        if (!options.systemAudio)
          for (const track of screen.getAudioTracks()) {
            track.stop()
            screen.removeTrack(track)
          }
        if (options.microphone)
          microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        ensureActive()
        const stream = new MediaStream(screen.getVideoTracks())
        if (microphone === undefined) {
          for (const track of screen.getAudioTracks()) stream.addTrack(track)
        } else {
          if (microphone.getAudioTracks().length === 0)
            throw new Error(UI_TEXT.media.recordingPermissionDenied)
          mixer = new AudioContext()
          const destination = mixer.createMediaStreamDestination()
          mixedTracks.push(...destination.stream.getTracks())
          if (screen.getAudioTracks().length > 0)
            mixer.createMediaStreamSource(screen).connect(destination)
          mixer.createMediaStreamSource(microphone).connect(destination)
          await mixer.resume()
          ensureActive()
          for (const track of destination.stream.getAudioTracks()) stream.addTrack(track)
        }
        return {
          tracks: [...screen.getTracks(), ...(microphone?.getTracks() ?? []), ...mixedTracks],
          release,
          createRecorder() {
            const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' })
            return {
              start: (timeslice) => {
                recorder.start(timeslice)
              },
              stop: () => {
                if (recorder.state !== 'inactive') recorder.stop()
              },
              listen(events) {
                const data = (event: BlobEvent) => {
                  events.data(event.data)
                }
                recorder.addEventListener('dataavailable', data)
                recorder.addEventListener('stop', events.stopped)
                recorder.addEventListener('error', events.error)
                return () => {
                  recorder.removeEventListener('dataavailable', data)
                  recorder.removeEventListener('stop', events.stopped)
                  recorder.removeEventListener('error', events.error)
                }
              },
            }
          },
        }
      } catch (error) {
        release()
        throw error
      }
    },
  }
}
