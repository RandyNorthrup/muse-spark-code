import { EventEmitter } from 'node:events'

/**
 * A helper process under test control: sent commands are recorded, output
 * lines are fed by hand, and the observed exit fires on demand. Voice tests
 * extend it with the stop/kill behaviour their driver needs.
 */
export class FakeHelperProcess {
  protected exitListener: ((description: string) => void) | undefined
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
  public readonly sent: string[] = []

  public send(line: string): void {
    this.sent.push(line)
  }

  public onExit(listener: (description: string) => void): void {
    this.exitListener = listener
  }

  public emitLine(payload: unknown): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`))
  }

  /** The process is observed gone; every end waiting on it proceeds. */
  public exit(description: string): void {
    this.exitListener?.(description)
  }
}
