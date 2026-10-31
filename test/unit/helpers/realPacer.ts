// A ModelApiPacing over real time: real Date.now, waits recorded and really
// slept over real timers. Shared so the duplication gate stays silent.
import { ModelApiPacing } from '../../../src/core/backends/modelapi/pacing'

export function realRecordingPacer(): {
  readonly pacing: ModelApiPacing
  readonly waits: number[]
} {
  const waits: number[] = []
  const pacing = new ModelApiPacing({
    now: () => Date.now(),
    wait: (ms: number) => {
      waits.push(ms)
      return new Promise<void>((done) => setTimeout(done, ms))
    },
  })
  return { pacing, waits }
}
