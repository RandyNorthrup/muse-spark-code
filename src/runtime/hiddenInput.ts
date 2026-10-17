// One line of secret input for `auth set` (PLAN.md D61). From a terminal it
// is read with echo off, a character at a time, Backspace honoured and
// Ctrl+C refused; from a pipe it is the first line. Either way the value
// goes nowhere but the caller.

import type { Readable, Writable } from 'node:stream'

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

function readPipedLine(input: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    input.setEncoding('utf8')
    input.on('data', (chunk: string) => {
      text += chunk
    })
    input.once('end', () => {
      resolve(text.split(LINE_BREAK, 1)[0] ?? '')
    })
    input.once('error', reject)
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
