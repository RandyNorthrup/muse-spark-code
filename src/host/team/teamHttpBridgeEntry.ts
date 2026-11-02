// The stdio-to-HTTP bridge for an external orchestrator (PLAN.md D250),
// a bundle of its own (`dist/teamHttpBridge.js`). An ACP agent that does
// not advertise HTTP MCP transport spawns this as its stdio MCP server; the
// bridge forwards every JSON-RPC line, unchanged, to the conversation's
// loopback team MCP endpoint and writes each answer back. It implements no
// tool itself — the endpoint stays the one implementation, with its
// per-conversation token, instructions and durable `command_id` answers.
//
// The endpoint and its headers arrive through the environment the client
// set in `session/new` (`MUSE_TEAM_BRIDGE_URL`,
// `MUSE_TEAM_BRIDGE_HEADERS` as a JSON object). The bridge posts that
// bearer only to literal loopback HTTP (`127.0.0.1` or `::1`); any other
// endpoint is a said refusal and is never contacted. A line that is not
// JSON, or a request the endpoint refuses at the HTTP layer, is answered
// with a JSON-RPC error naming the refusal — never dropped silently.

import { createInterface } from 'node:readline'
import { bridgeAnswer } from './teamHttpBridge'

async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, terminal: false })
  // Serial: the endpoint's durable answers assume a request settles before
  // its retry arrives, and stdio clients read answers in order.
  for await (const line of lines) {
    if (line.trim() === '') continue
    const answer = await bridgeAnswer(line, process.env)
    if (answer !== undefined) process.stdout.write(`${answer}\n`)
  }
}

void main()
