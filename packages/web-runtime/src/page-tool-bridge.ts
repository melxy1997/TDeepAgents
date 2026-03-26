/**
 * page-tool-bridge.ts — Cross-page tool routing for SPAs.
 *
 * Solves the problem of SPA page-scoped tools: when AI needs to call
 * a tool that belongs to a page not currently loaded, this bridge
 * navigates to that page first, then forwards the tool call via
 * window.postMessage.
 *
 * Architecture:
 * 1. MCP Server (in the app shell) registers tools with RouteConfig
 * 2. When a tool is called, the bridge checks if the target page is active
 * 3. If not active → calls navigator to switch route → waits for page-ready
 * 4. Forwards tool call via postMessage → page handler processes → returns result
 *
 * Message protocol (namespaced to avoid collisions):
 * - tda:tool-call     → bridge → target page
 * - tda:tool-response → target page → bridge
 * - tda:page-ready    → target page → bridge (on mount)
 * - tda:page-leave    → target page → bridge (on unmount)
 */

import type { ZodRawShape } from 'zod';
import type { WebSkillRuntime, SkillConfig, SkillHandler } from './web-skill-runtime.js';

// ─── Constants ───────────────────────────────────────────────────────

const MSG_PREFIX = 'tda:';
const MSG_TOOL_CALL = `${MSG_PREFIX}tool-call`;
const MSG_TOOL_RESPONSE = `${MSG_PREFIX}tool-response`;
const MSG_PAGE_READY = `${MSG_PREFIX}page-ready`;
const MSG_PAGE_LEAVE = `${MSG_PREFIX}page-leave`;

// ─── Types ───────────────────────────────────────────────────────────

/** Route configuration for a page-routed skill */
export interface RouteConfig {
  /** Target route path (e.g., '/orders') */
  route: string;
  /** Timeout for waiting for page response (ms), default 30000 */
  timeout?: number;
}

// ─── Internal State ──────────────────────────────────────────────────

/** Active pages: route → true (set when registerPageHandler is called) */
const activePages = new Map<string, boolean>();

/** Tool → route mapping */
const toolRouteMap = new Map<string, string>();

/** Registered navigator function */
let _navigator: ((route: string) => void | Promise<void>) | null = null;

// ─── Utility ─────────────────────────────────────────────────────────

/** Normalize route: remove trailing slashes, fallback to '/' */
function normalizeRoute(value: string): string {
  return value.replace(/\/+$/, '') || '/';
}

/** Generate a unique ID for correlating tool calls and responses */
function generateCallId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Register the application's navigation function.
 * Typically called once in the app entry point (e.g., main.ts).
 *
 * @example
 * ```ts
 * import { useRouter } from 'vue-router';
 * const router = useRouter();
 * setNavigator((route) => router.push(route));
 * ```
 */
export function setNavigator(fn: (route: string) => void | Promise<void>): void {
  _navigator = fn;
}

/**
 * Get the current tool→route mapping (read-only snapshot).
 * Useful for debugging which tools are bound to which routes.
 */
export function getToolRouteMap(): ReadonlyMap<string, string> {
  return new Map(toolRouteMap);
}

/**
 * Get the set of currently active (mounted) routes.
 */
export function getActiveRoutes(): ReadonlySet<string> {
  return new Set(activePages.keys());
}

// ─── Page Handler Registration ───────────────────────────────────────

/**
 * Activate tool handlers on a target page.
 *
 * Call this in the target page's component setup/mounted hook.
 * Returns a cleanup function to call on unmount.
 *
 * @example
 * ```ts
 * // In /orders page component
 * onMounted(() => {
 *   const cleanup = registerPageHandler({
 *     route: '/orders',
 *     handlers: {
 *       order_query: async ({ customerName }) => {
 *         return await queryOrders({ customerName });
 *       },
 *     },
 *   });
 *   onUnmounted(cleanup);
 * });
 * ```
 */
export function registerPageHandler(options: {
  /** Target route. Defaults to window.location.pathname if omitted. */
  route?: string;
  /** Tool name → handler function mapping */
  handlers: Record<string, (input: unknown) => Promise<unknown>>;
}): () => void {
  const { route: routeOption, handlers } = options;
  const route = normalizeRoute(routeOption ?? window.location.pathname);

  const handleMessage = async (event: MessageEvent) => {
    if (
      event.data?.type !== MSG_TOOL_CALL ||
      normalizeRoute(String(event.data?.route ?? '')) !== route ||
      !(event.data.toolName in handlers)
    ) {
      return;
    }

    const { callId, toolName, input } = event.data;
    try {
      const result = await handlers[toolName](input);
      window.postMessage(
        { type: MSG_TOOL_RESPONSE, callId, result },
        window.location.origin || '*',
      );
    } catch (err) {
      window.postMessage(
        {
          type: MSG_TOOL_RESPONSE,
          callId,
          error: err instanceof Error ? err.message : String(err),
        },
        window.location.origin || '*',
      );
    }
  };

  // Mark page as active and broadcast ready signal
  activePages.set(route, true);
  window.addEventListener('message', handleMessage);
  window.postMessage(
    { type: MSG_PAGE_READY, route },
    window.location.origin || '*',
  );

  // Return cleanup function
  return () => {
    activePages.delete(route);
    window.removeEventListener('message', handleMessage);
    window.postMessage(
      { type: MSG_PAGE_LEAVE, route },
      window.location.origin || '*',
    );
  };
}

// ─── Page-Routed Handler Builder ─────────────────────────────────────

/**
 * Build a handler function that forwards tool calls to a specific page
 * via postMessage. Handles navigation if the page isn't active.
 */
function buildPageHandler(
  name: string,
  route: string,
  timeout = 30000,
): (input: unknown) => Promise<unknown> {
  return (input: unknown): Promise<unknown> => {
    const callId = generateCallId();

    return new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      let readyHandler: ((event: MessageEvent) => void) | undefined;

      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('message', responseHandler);
        if (readyHandler) {
          window.removeEventListener('message', readyHandler);
        }
      };

      // Timeout guard
      timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Tool [${name}] call timed out (${timeout}ms). ` +
            `Ensure the target page (${route}) calls registerPageHandler().`,
          ),
        );
      }, timeout);

      // Response handler (matched by callId)
      const responseHandler = (event: MessageEvent) => {
        if (
          event.data?.type === MSG_TOOL_RESPONSE &&
          event.data.callId === callId
        ) {
          cleanup();
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data.result);
          }
        }
      };
      window.addEventListener('message', responseHandler);

      const sendCall = () => {
        window.postMessage(
          { type: MSG_TOOL_CALL, callId, toolName: name, route, input },
          window.location.origin || '*',
        );
      };

      // Single-send guard
      let callSent = false;
      const sendCallOnce = () => {
        if (callSent) return;
        callSent = true;
        sendCall();
      };

      const run = async () => {
        try {
          if (activePages.get(route)) {
            sendCallOnce();
            return;
          }

          // Register page-ready listener before navigating
          readyHandler = (event: MessageEvent) => {
            if (
              event.data?.type === MSG_PAGE_READY &&
              normalizeRoute(String(event.data.route ?? '')) === route
            ) {
              window.removeEventListener('message', readyHandler!);
              sendCallOnce();
            }
          };
          window.addEventListener('message', readyHandler);

          // Navigate
          if (_navigator) {
            await _navigator(route);
          }

          // Double-check after navigation
          if (activePages.get(route)) {
            window.removeEventListener('message', readyHandler);
            sendCallOnce();
          }
        } catch (err) {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void run();
    });
  };
}

// ─── Wait for Page Ready ─────────────────────────────────────────────

/**
 * Wait for a page to broadcast its ready signal.
 * Used internally before sending tool calls after navigation.
 */
function waitForPageReady(path: string, timeoutMs = 1500): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const target = normalizeRoute(path);

  return new Promise<void>((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', handleMessage);
      resolve();
    };

    const handleMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.type !== MSG_PAGE_READY
      ) return;
      if (normalizeRoute(String(event.data.route ?? '')) === target) {
        finish();
      }
    };

    window.addEventListener('message', handleMessage);
    setTimeout(finish, timeoutMs);
  });
}

// ─── withPageRouting ─────────────────────────────────────────────────

/**
 * Wrap a WebSkillRuntime so that `registerSkill` calls with a `route`
 * config automatically use page-routed handlers.
 *
 * Skills without a `route` config are registered normally (handler runs
 * in the current page context, same as without wrapping).
 *
 * @example
 * ```ts
 * const bridge = new PageToolBridge();
 * bridge.setNavigator((r) => router.push(r));
 * const runtime = withPageRouting(new WebSkillRuntime());
 *
 * runtime.registerSkill('order_query', {
 *   description: 'Query orders',
 *   inputSchema: { ... },
 *   route: '/orders',
 * }, handler);  // handler runs on /orders page via postMessage
 * ```
 */
export function withPageRouting(runtime: WebSkillRuntime): WebSkillRuntime {
  const originalRegister = runtime.registerSkill.bind(runtime);

  // Override registerSkill with route-aware version
  runtime.registerSkill = function <T extends ZodRawShape>(
    name: string,
    config: SkillConfig<T>,
    handler: SkillHandler<T>,
  ): void {
    if (config.route) {
      // Route-config mode: use page-routed handler
      const route = normalizeRoute(config.route);
      const timeout = config.timeout ?? 30000;
      toolRouteMap.set(name, route);

      const pageHandler = buildPageHandler(name, route, timeout);
      originalRegister(
        name,
        config,
        pageHandler as SkillHandler<T>,
      );
    } else {
      // Direct mode: handler runs in current context
      originalRegister(name, config, handler);
    }
  };

  return runtime;
}
