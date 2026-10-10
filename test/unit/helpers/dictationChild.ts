import { EventEmitter } from 'node:events'
import type { HelperChild } from '../../../src/core/voice/dictation'

/** A helper process under test control: commands are recorded, output is fed. */
export class FakeChild implements HelperChild {
  private exitListener: ((description: string) => void) | undefined
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
  public readonly sent: string[] = []
  public killCount = 0

  public send(line: string): void {
    this.sent.push(line)
  }

  public onExit(listener: (description: string) => void): void {
    this.exitListener = listener
  }

  public kill(): void {
    this.killCount += 1
  }

  public emitLine(payload: unknown): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`))
  }

  public exit(description: string): void {
    this.exitListener?.(description)
  }
}
