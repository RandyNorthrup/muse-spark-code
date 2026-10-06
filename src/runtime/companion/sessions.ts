import { randomBytes } from 'node:crypto'
import { IDE_MCP_TOKEN_BYTES } from '../../shared/constants'
import { isSameSecret } from './guard'

export interface CompanionSession {
  readonly id: string
  readonly expiresAt: number
  readonly context?: string
}

/** Per-start memory only. Codes expire, burn before dispatch, and mint independent bearers. */
export class CompanionSessions {
  private readonly codes = new Map<
    string,
    { readonly expiresAt: number; readonly context?: string }
  >()
  private readonly sessions = new Map<string, CompanionSession>()

  public constructor(
    private readonly codeTtlMs: number,
    private readonly sessionTtlMs: number,
    private readonly maxSessions: number,
  ) {}

  private prune(): void {
    const now = Date.now()
    for (const [code, entry] of this.codes) if (now >= entry.expiresAt) this.codes.delete(code)
    for (const [id, session] of this.sessions)
      if (now >= session.expiresAt) this.sessions.delete(id)
  }

  public issue(context?: string): string {
    this.prune()
    if (this.codes.size + this.sessions.size >= this.maxSessions) throw new Error('EPANEL_SESSIONS')
    const code = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    this.codes.set(code, {
      expiresAt: Date.now() + this.codeTtlMs,
      ...(context !== undefined && { context }),
    })
    return code
  }

  public exchange(code: string): CompanionSession | undefined {
    this.prune()
    let found: string | undefined
    for (const candidate of this.codes.keys()) {
      if (isSameSecret(code, candidate)) {
        found = candidate
        break
      }
    }
    if (found === undefined) return undefined
    const context = this.codes.get(found)?.context
    this.codes.delete(found)
    const id = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    const session = {
      id,
      expiresAt: Date.now() + this.sessionTtlMs,
      ...(context !== undefined && { context }),
    }
    this.sessions.set(id, session)
    return session
  }

  public get(id: string | undefined): CompanionSession | undefined {
    this.prune()
    return id === undefined ? undefined : this.sessions.get(id)
  }

  public retireContext(context: string): readonly string[] {
    for (const [code, entry] of this.codes) if (entry.context === context) this.codes.delete(code)
    const retired: string[] = []
    for (const [id, session] of this.sessions) {
      if (session.context !== context) continue
      this.sessions.delete(id)
      retired.push(id)
    }
    return retired
  }
  public clear(): void {
    this.codes.clear()
    this.sessions.clear()
  }
}
