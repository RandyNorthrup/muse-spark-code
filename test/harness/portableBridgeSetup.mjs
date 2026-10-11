// Shared fake transports for browser qualification and the production boot gate.
export function portableBridgeSetup(bridge, wireVersion) {
  return String.raw`
        const assetFetch = window.fetch.bind(window);
        const posts = []; let listener; let stream;
        window.fixturePosts = posts;
        const host = {
          postMessage: value => posts.push(value), getState: () => undefined,
          setState: () => {}, onMessage: value => { listener = value; return () => {}; }
        };
        window.fixtureReceive = payload => {
          if (${JSON.stringify(bridge)} === 'companion') stream.enqueue(new TextEncoder().encode(
            'data: ' + JSON.stringify({ mhp: ${JSON.stringify(wireVersion)}, kind: 'panel', direction: 'toPanel', surface: 'startup', seq: 1, payload }) + '\n\n'));
          else if (listener) listener(payload);
          else window.dispatchEvent(new MessageEvent('message', { data: payload }));
        };
        if (${JSON.stringify(bridge)} === 'native') window.museHost = host;
        else if (${JSON.stringify(bridge)} === 'vscode') window.acquireVsCodeApi = () => host;
        else window.fetch = async (input, init) => {
          if (input === '/host/events') return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/event-stream' } });
          if (input === '/panel/events') return new Response(new ReadableStream({ start(value) { stream = value; } }), { headers: { 'Content-Type': 'text/event-stream' } });
          if (!['/host/message', '/panel/message', '/panel/surface'].includes(input)) return assetFetch(input, init);
          const frame = JSON.parse(init.body);
          if (frame.kind === 'panel') posts.push(frame.payload);
          return new Response(null, { status: 204 });
        };
      `
}
