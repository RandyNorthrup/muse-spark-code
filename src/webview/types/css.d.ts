// Lets the webview import its stylesheet for esbuild to emit main.css.
// TypeScript 6 checks side-effect imports (TS2882) and needs this ambient
// module to know that `*.css` resolves.
declare module '*.css'
