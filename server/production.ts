// A cross-platform production entry point, with no TypeScript runner needed at runtime.
process.env.NODE_ENV = 'production'
await import('./index.js')
export {}
