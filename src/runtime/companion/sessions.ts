import { randomBytes } from 'node:crypto'
import { IDE_MCP_TOKEN_BYTES } from '../../shared/constants'
import { isSameSecret } from './guard'

export interface CompanionSession {
  readonly id: string
  readonly expiresAt: number
}

/** Per-start memory only. Codes expire, burn before dispatch, and never become cookies. */
export class CompanionSessions {
  private readonly codes = new Map<string, number>()
  private readonly sessions = new Map<string, CompanionSession>()

  public constructor(
    private readonly codeTtlMs: number,
    private readonly sessionTtlMs: number,
    private readonly maxSessions: number,
  ) {}

  private prune(): void {
    const now = Date.now()
    for (const [code, expiresAt] of this.codes) if (now >= expiresAt) this.codes.delete(code)
    for (const [id, session] of this.sessions)
      if (now >= session.expiresAt) this.sessions.delete(id)
  }

  public issue(): string {
    this.prune()
    if (this.codes.size + this.sessions.size >= this.maxSessions) throw new Error('EPANEL_SESSIONS')
    const code = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    this.codes.set(code, Date.now() + this.codeTtlMs)
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
    this.codes.delete(found)
    const id = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    const session = { id, expiresAt: Date.now() + this.sessionTtlMs }
    this.sessions.set(id, session)
    return session
  }

  public get(id: string | undefined): CompanionSession | undefined {
    this.prune()
    return id === undefined ? undefined : this.sessions.get(id)
  }

  public clear(): void {
    this.codes.clear()
    this.sessions.clear()
  }
}
