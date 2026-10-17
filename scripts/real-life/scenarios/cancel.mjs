// A person stops a turn while the answer is still coming. The turn ends as
// cancelled, at once, and the conversation can be used again.
import { performance } from 'node:perf_hooks'

const LONG =
  'In your reply itself, with no tool and no file, count from 1 to 300 in words, one number per line, and do not stop or summarise before 300.'
// The model's own answer is under way: the count has reached three. What the
// product says by itself before the answer (a notice) is not the answer.
const COUNTING = /\b(?:three|3)\b/iu
const FINISHED = /three hundred|\b300\b/iu
const ANSWERS_WITHIN_MS = 60_000
const STOPS_WITHIN_SECONDS = 5
const ANSWERING = 'answering'

/** Waits until the model's own answer is under way, and says so, or says that none came. */
async function answerUnderWay(editor, heard) {
  try {
    await editor.nextUpdate((entry) => {
      const update = entry.update ?? {}
      if (update.sessionUpdate === 'tool_call') return true
      if (update.sessionUpdate !== 'agent_message_chunk') return false
      heard.text += update.content?.type === 'text' ? update.content.text : ''
      return COUNTING.test(heard.text)
    }, ANSWERS_WITHIN_MS)
    return ANSWERING
  } catch {
    return 'no answer came'
  }
}

async function endOf(running) {
  const ended = await running.done
  return `the turn had ended (${String(ended.stopReason)})`
}

export default {
  title: 'A turn is cancelled in the middle',
  acp: {
    claims: ['ref/feature/acp'],
    // The cancelled request, then the next turn: a model may use a tool in it.
    requests: 4,
    async run(person, see) {
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const heard = { text: '' }
      const underWay = answerUnderWay(editor, heard)
      const running = session.start(LONG)
      const first = await Promise.race([underWay, endOf(running)])
      see(
        'the answer is under way when the person stops it',
        first === ANSWERING,
        first === ANSWERING ? `${String(heard.text.length)} characters so far` : first,
      )
      const stopped = performance.now()
      running.cancel()
      const turn = await running.done
      const seconds = (performance.now() - stopped) / 1000
      see('the turn ends as cancelled', turn.stopReason === 'cancelled', turn.stopReason)
      see(
        `the turn ends within ${String(STOPS_WITHIN_SECONDS)} seconds of the stop`,
        seconds <= STOPS_WITHIN_SECONDS,
        `${seconds.toFixed(1)} s`,
      )
      see(
        'the answer stopped before its end',
        !FINISHED.test(turn.said),
        `${String(turn.said.length)} characters arrived`,
      )
      // What the model makes of a cut-off request is its own business: the
      // conversation taking the next message and answering it is the product's.
      const next = await session.prompt('Reply with the one word OK.')
      see(
        'the conversation takes the next message and answers it',
        next.stopReason === 'end_turn' && next.said.trim() !== '',
        `${next.stopReason}: ${next.said}`,
      )
    },
  },
}
