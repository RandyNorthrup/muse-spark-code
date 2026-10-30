// The CodeMirror tests drive the real editor, whose view needs the
// layout primitives jsdom leaves out. This completes the environment
// (as jsdom itself does for the rest of the DOM); it stands in for no
// product code. Call it once at module scope before rendering.
export function installCodeMirrorDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: class {
        observe(): void {
          /* jsdom has no layout to observe */
        }
        unobserve(): void {
          /* jsdom has no layout to observe */
        }
        disconnect(): void {
          /* jsdom has no layout to observe */
        }
      },
      configurable: true,
      writable: true,
    })
  }
  for (const key of ['getClientRects', 'getBoundingClientRect'] as const) {
    if (typeof Range.prototype[key] !== 'function') {
      Object.defineProperty(Range.prototype, key, {
        value: key === 'getClientRects' ? () => [] : () => new DOMRect(),
        configurable: true,
        writable: true,
      })
    }
  }
}
