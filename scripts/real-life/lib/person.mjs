// What a scenario can do: what a person does at a terminal, and what an
// editor does over the editor protocol. Each scenario gets its own, in its
// own empty workspace, on one route.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { READ_BACK_USD, isTurnedAwayUnsent, modelNamed } from './admission.mjs'
import { microUsd } from './budget.mjs'
import { jsonLines, runCommand, saidIn, startEditor } from './product.mjs'
import { parseUsageOutput } from './record.mjs'
import { editorArguments, routeArguments } from './routes.mjs'

const MODEL_OPTION = 'model'
const PERMISSION_KIND = { allow: 'allow_once', reject: 'reject_once' }

/**
 * @param {object} cell
 * @param {import('./product.mjs').Product} cell.product
 * @param {object} cell.route the route as lib/routes.mjs gives it
 * @param {string} cell.workspace a new, empty folder
 * @param {string} cell.admitUsd the hard cap handed to each `exec` (the product reserves a request's worst case against it)
 * @param {string | undefined} cell.key the route's key, for a route that takes it on standard input
 */
export function personFor(cell) {
  const { product, route, workspace } = cell
  const editors = []
  const logs = []
  const made = { requests: 0, micro: 0, uncertain: 0, turnedAway: 0, unread: [], missingResults: 0 }
  const notes = []
  const skipped = []

  async function command(args, options = {}) {
    const run = await runCommand(product, args, { cwd: workspace, ...options })
    logs.push(run.stderr)
    return run
  }

  /** One `exec` with the route's arguments and one budget, its result read from the JSONL it prints. */
  async function execOnce(prompt, options, budget) {
    const isKeyOnPipe = route.kind === 'meta'
    const args = [
      'exec',
      ...routeArguments(options.model === undefined ? route : { ...route, ...options.model }),
      '--permission-mode',
      options.mode ?? 'plan',
      '--max-requests',
      String(options.maxRequests ?? 1),
      '--max-budget-usd',
      budget,
      '--output',
      'jsonl',
      ...(isKeyOnPipe ? ['--key-stdin'] : []),
      ...(options.args ?? []),
      prompt,
    ]
    let run
    try {
      run = await command(args, { stdin: isKeyOnPipe ? `${cell.key ?? ''}\n` : '' })
    } catch (error) {
      made.missingResults += 1
      throw error
    }
    const events = jsonLines(run.stdout)
    const result = events.findLast((event) => event.type === 'result')?.result
    // What the product's own ledger says of it: usage a provider reported
    // (settled), and what it booked with no usage report (uncertain).
    const cost = result?.usage?.costUsd
    const requests = result?.usage?.requests
    if (
      !Number.isSafeInteger(requests) ||
      requests < 0 ||
      cost?.settled === undefined ||
      cost?.uncertain === undefined
    ) {
      made.missingResults += 1
    }
    made.requests += Number.isSafeInteger(requests) && requests >= 0 ? requests : 0
    made.micro += readUsd(cost?.settled, 'settled')
    made.uncertain += readUsd(cost?.uncertain, 'uncertain')
    return { ...run, events, result }
  }

  /**
   * An amount the product printed, in millionths of a dollar. One it did not
   * print is nothing; one the run cannot read is spend nobody knows, and is
   * kept as the text it was (`made.unread`).
   */
  function readUsd(text, what) {
    if (text === undefined || text === null) return 0
    const micro = microUsd(text)
    if (!Number.isNaN(micro)) return micro
    made.unread.push(`${what}: ${String(text)}`)
    return 0
  }

  /**
   * A turn on a route to Meta's own models: first what the product would
   * run, asked with a budget under which nothing can be sent; the turn
   * itself only when that is the route's model (lib/admission.mjs).
   */
  async function execReadBack(prompt, options) {
    const asked = await execOnce(prompt, options, READ_BACK_USD)
    if (!isTurnedAwayUnsent(asked)) {
      // The product ended the run for a reason of its own before a budget
      // mattered (nothing to compact, say): that was the turn. Had it sent
      // anything under such a budget, the turn says so.
      const sent = asked.result?.usage?.requests ?? 0
      if (sent > 0) {
        notes.push({
          what: 'nothing is sent under a budget of one millionth of a dollar',
          ok: false,
          saw: `${String(sent)} request(s)`,
        })
      }
      return asked
    }
    made.turnedAway += 1
    const named = modelNamed(asked.events)
    notes.push({
      what: 'before anything is sent the product names the model of the route',
      ok: named === route.modelId,
      saw: named ?? 'it named no model',
    })
    return named === route.modelId ? await execOnce(prompt, options, cell.admitUsd) : asked
  }

  /** One headless turn. */
  async function exec(prompt, options = {}) {
    if (route.kind === 'provider') return await execOnce(prompt, options, cell.admitUsd)
    // A route to Meta's own models: the route's model, read back, and no other.
    if (options.model !== undefined) {
      throw new Error(`a turn on the route ${route.id} is never asked on another model`)
    }
    return await execReadBack(prompt, options)
  }

  function sessionOf(editor, sessionId, opened) {
    const modelOption = () =>
      (opened.configOptions ?? []).find((option) => option.id === MODEL_OPTION)
    const session = {
      sessionId,
      modes: opened.modes,
      /** The models the session offers, as the editor's picker shows them. */
      models: () => (modelOption()?.options ?? []).map((option) => option.value),
      currentModel: () => modelOption()?.currentValue,
      async setModel(value) {
        // A session of a route to Meta's own models is never put on any
        // model but the route's: no scenario can ask for another.
        if (route.kind !== 'provider' && value !== route.modelId) {
          throw new Error(
            `a session of the route ${route.id} is never set to ${String(value)}: only to ${route.modelId}`,
          )
        }
        const set = await editor.request('session/set_config_option', {
          sessionId,
          configId: MODEL_OPTION,
          value,
        })
        opened.configOptions = set.configOptions
        return session.currentModel()
      },
      async setMode(modeId) {
        await editor.request('session/set_mode', { sessionId, modeId })
      },
      /** Starts a prompt and hands back its end, so a scenario can act while it runs. */
      start(text, options = {}) {
        // Nothing is ever sent on a model the route did not name: a session
        // that sits on another one (a dearer tier, an unknown one) is not used.
        if (session.currentModel() !== route.modelId) {
          throw new Error(
            `the session is on ${String(session.currentModel())}, not on ${route.modelId}: nothing was sent`,
          )
        }
        const kind = PERMISSION_KIND[options.permissions]
        editor.answerPermissions((asked) =>
          kind === undefined ? undefined : asked.options.find((one) => one.kind === kind)?.optionId,
        )
        const from = { updates: editor.updates.length, permissions: editor.permissions.length }
        const ended = async () => {
          const answer = await editor.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text }],
          })
          const updates = editor.updates.slice(from.updates)
          return {
            stopReason: answer.stopReason,
            said: saidIn(updates),
            updates,
            asked: editor.permissions.slice(from.permissions),
          }
        }
        return { done: ended(), cancel: () => editor.notify('session/cancel', { sessionId }) }
      },
      async prompt(text, options) {
        return await session.start(text, options).done
      },
    }
    return session
  }

  /** The agent started as an editor starts it for the route, initialized. */
  async function openEditor(extraArguments = []) {
    const editor = startEditor(product, [...editorArguments(route), ...extraArguments], {
      cwd: workspace,
    })
    editors.push(editor)
    const initialized = await editor.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'real-life-run', version: '1' },
    })
    return {
      initialized,
      nextUpdate: editor.nextUpdate,
      /** A new session on the route's model, chosen in the session as a person chooses it. */
      async newSession() {
        const opened = await editor.request('session/new', { cwd: workspace, mcpServers: [] })
        const session = sessionOf(editor, opened.sessionId, opened)
        if (session.currentModel() !== route.modelId) await session.setModel(route.modelId)
        return session
      },
      async listSessions() {
        const listed = await editor.request('session/list', { cwd: workspace })
        return listed.sessions ?? []
      },
      async loadSession(sessionId) {
        const from = editor.updates.length
        const opened = await editor.request('session/load', {
          sessionId,
          cwd: workspace,
          mcpServers: [],
        })
        return { ...sessionOf(editor, sessionId, opened), replayed: editor.updates.slice(from) }
      },
      /** Ends the agent as an editor does when its window closes. */
      stop: () => editor.stop(),
    }
  }

  return {
    route,
    workspace,
    /** A word no model would say by itself: the prompt asks for it, the scenario looks for it. */
    marker: () => `RL-${randomBytes(4).toString('hex').toUpperCase()}`,
    /**
     * An ordinary request no model has a reason to refuse, whose answer
     * still proves it came from this turn: the reference code comes back.
     * (A bare "reply with exactly this" was refused by one model as an
     * order to print a token.)
     */
    connectionCheck: (code) =>
      `This is a connection check. Please confirm that you received this message by quoting its reference code back to me. The reference code is ${code}.`,
    command,
    exec,
    openEditor,
    /**
     * The product's own usage records for this home, as `usage --json`
     * prints them. An unreadable usage fails the scenario: it is spend
     * nobody knows, never an empty reading.
     */
    async usage() {
      const read = parseUsageOutput(await command(['usage', '--json']))
      if (!read.ok) throw new Error(`the usage could not be read: ${read.reason}`)
      return read.records
    },
    /** The text of a file in the workspace, or nothing when there is none. */
    file(name) {
      const file = path.join(workspace, name)
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined
    },
    /** What the exec commands of this cell made, by the product's own ledger. */
    made,
    /** What was seen on the way to a turn (the model the product named), as observations. */
    notes,
    /** A step the scenario leaves out on this route, and why: the record says so. */
    skip(what, why) {
      skipped.push({ what, why })
    },
    skipped,
    /** The product's own log lines of this cell. */
    logText: () => logs.join('\n'),
    /** Ends every agent the scenario left running. */
    async end() {
      for (const editor of editors) {
        await editor.stop()
        logs.push(editor.stderr)
      }
    },
  }
}
