// ─── Browser-safe exports for @tdeepagents/backends ──────────────────
// This entry point excludes FilesystemBackend (which depends on node:fs)
// and is safe to bundle with Vite/Webpack for browser environments.

export type { BackendProtocol } from './protocol.js';
export { StateBackend } from './state-backend.js';
export { CompositeBackend } from './composite-backend.js';
