// ─── @tdeepagents/web-runtime ─────────────────────────────────────────
// Browser-side WebSkills runtime: register JS functions as MCP tools.

export {
  WebSkillRuntime,
  type WebSkillRuntimeConfig,
  type SkillConfig,
  type SkillHandler,
} from './web-skill-runtime.js';

export {
  MessageChannelTransport,
  createMessageChannelPair,
} from './transports.js';

export {
  setNavigator,
  registerPageHandler,
  withPageRouting,
  getToolRouteMap,
  getActiveRoutes,
  type RouteConfig,
} from './page-tool-bridge.js';

export {
  initWebMcpShim,
  type ModelContext,
  type ModelContextTool,
} from './webmcp-shim.js';
