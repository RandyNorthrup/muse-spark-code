// One line of secret input for `auth set` (PLAN.md D61). From a terminal it
// is read with echo off, a character at a time, Backspace honoured and
// Ctrl+C refused; from a pipe it is the first line. Either way the value
// goes nowhere but the caller.

import type { Readable, Writable } from 'node:stream'
import { UI_TEXT } from '../shared/constants'

/** The slice of `process.stdin` the reader uses; a TTY stream has `setRawMode`. */
export interface InputStream extends Readable {
  readonly isTTY?: boolean
  setRawMode?(isRaw: boolean): unknown
}

const ENTER = new Set(['\r', '\n'])
const BACKSPACE = new Set(['\u{7F}', '\b'])
const INTERRUPT = '\u{3}'
const END_OF_INPUT = '\u{4}'
const LINE_BREAK = /\r?\n/

/**
 * Piped standard input was not UTF-8 text, so no key line could be read
 * from it. The message is the shared not-text sentence, read when thrown;
 * callers match it with {@link isNonTextStdin} (never `instanceof`, which
 * breaks across the split bundles that carry this module).
 */
export class NonTextStdinError extends Error {
  readonly code = 'stdin-not-text'
  constructor() {
    super(UI_TEXT.providerKeyNotText)
    this.name = 'NonTextStdinError'
  }
}

/** Whether a secret read failed because piped stdin was not UTF-8 text. */
export function isNonTextStdin(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'stdin-not-text'
}

function readPipedLine(input: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const pieces: Buffer[] = []
    const failure = (error: unknown) => {
      for (const piece of pieces) piece.fill(0)
      pieces.length = 0
      reject(error instanceof Error ? error : new Error(UI_TEXT.execInterrupted, { cause: error }))
    }
    input.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        pieces.push(Buffer.from(chunk, 'utf8'))
      } else if (Buffer.isBuffer(chunk)) {
        pieces.push(chunk)
      } else {
        // Anything but bytes or text is not a key line either.
        failure(new NonTextStdinError())
      }
    })
    input.once('end', () => {
      const bytes = Buffer.concat(pieces)
      for (const piece of pieces) piece.fill(0)
      pieces.length = 0
      let line: string
      try {
        line = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        reject(new NonTextStdinError())
        return
      } finally {
        bytes.fill(0)
      }
      resolve(line.split(LINE_BREAK, 1)[0] ?? '')
    })
    input.once('error', failure)
  })
}

function readTypedLine(input: InputStream, output: Writable): Promise<string> {
  return new Promise((resolve, reject) => {
    let typed = ''
    const finish = (error?: Error) => {
      input.setRawMode?.(false)
      input.pause()
      input.removeListener('data', onData)
      output.write('\n')
      if (error === undefined) {
        resolve(typed)
      } else {
        reject(error)
      }
    }
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === END_OF_INPUT || ENTER.has(character)) {
          finish()
          return
        }
        if (character === INTERRUPT) {
          finish(new Error('Cancelled'))
          return
        }
        typed = BACKSPACE.has(character) ? typed.slice(0, -1) : `${typed}${character}`
      }
    }
    input.setEncoding('utf8')
    input.setRawMode?.(true)
    input.on('data', onData)
    input.resume()
  })
}

/** Writes `prompt` to `output`, then reads the line without showing it. */
export async function readSecretLine(
  prompt: string,
  input: InputStream,
  output: Writable,
): Promise<string> {
  if (input.isTTY !== true) {
    return await readPipedLine(input)
  }
  output.write(prompt)
  return await readTypedLine(input, output)
}
