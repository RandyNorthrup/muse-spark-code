import { resourceEventSchema, type ResourceEvent } from '../../shared/resources'

/** Only the shared, privacy-bounded event shape crosses this subscription. */
export class ResourceEvents {
  private readonly listeners = new Set<(event: ResourceEvent) => void>()

  constructor(private readonly onError: (error: unknown) => void) {}

  subscribe(listener: (event: ResourceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(event: ResourceEvent): void {
    const parsed = resourceEventSchema.parse(event)
    const listeners = [...this.listeners]
    for (const listener of listeners) {
      try {
        listener(structuredClone(parsed))
      } catch (error) {
        this.onError(error)
      }
    }
  }
}
