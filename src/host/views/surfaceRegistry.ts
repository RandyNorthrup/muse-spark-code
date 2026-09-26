// Tracks every open chat surface and which one last had the user's attention,
// so keybindings and settings broadcasts know where to send messages.

import type * as vscode from 'vscode'
import type { HostToWebviewMessage } from '../../shared/protocol'
import type { ChatSurface } from './chatSurface'

export class SurfaceRegistry {
  private readonly surfaces = new Map<string, ChatSurface>()
  private readonly removedListeners = new Set<(surface: ChatSurface) => void>()
  private activeId: string | undefined

  /** Registers a surface; the returned disposable unregisters it. */
  public add(surface: ChatSurface): vscode.Disposable {
    this.surfaces.set(surface.id, surface)
    this.activeId ??= surface.id
    return {
      dispose: () => {
        this.surfaces.delete(surface.id)
        if (this.activeId === surface.id) {
          this.activeId = this.surfaces.keys().next().value
        }
        for (const listener of this.removedListeners) {
          listener(surface)
        }
      },
    }
  }

  /** Observe surfaces leaving the registry (view closed, panel disposed). */
  public onRemoved(listener: (surface: ChatSurface) => void): vscode.Disposable {
    this.removedListeners.add(listener)
    return {
      dispose: () => {
        this.removedListeners.delete(listener)
      },
    }
  }

  public setActive(surface: ChatSurface): void {
    if (this.surfaces.has(surface.id)) {
      this.activeId = surface.id
    }
  }

  /** The surface that last reported focus, else the earliest registered one. */
  public get active(): ChatSurface | undefined {
    return this.activeId === undefined ? undefined : this.surfaces.get(this.activeId)
  }

  public get size(): number {
    return this.surfaces.size
  }

  public broadcast(message: HostToWebviewMessage): void {
    for (const surface of this.surfaces.values()) {
      surface.post(message)
    }
  }
}
