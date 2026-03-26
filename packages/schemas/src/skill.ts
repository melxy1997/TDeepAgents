import { z } from 'zod';

/**
 * Skill metadata schema — follows the Agent Skills Specification
 * (https://agentskills.io/specification).
 *
 * Frontmatter fields from SKILL.md:
 * - name (required): skill identifier, lowercase a-z and hyphens
 * - description (required): what the skill does and when to use it
 * - license, compatibility, metadata, allowed-tools (optional)
 * - web-skill, mcp-server, route, tools (optional, WebSkills extension)
 */
export const SkillMetadataSchema = z.object({
  /** Unique skill name (1-64 chars, lowercase a-z and hyphens) */
  name: z.string(),
  /** What the skill does and when to use it (1-1024 chars) */
  description: z.string(),
  /** Path to the SKILL.md file in the backend filesystem */
  path: z.string(),
  /** License identifier (optional) */
  license: z.string().optional(),
  /** Environment requirements (optional, 1-500 chars) */
  compatibility: z.string().optional(),
  /** Custom metadata key-value pairs */
  metadata: z.record(z.string()).optional(),
  /** Tools this skill requires or is allowed to use */
  allowedTools: z.array(z.string()).optional(),
  /** Discovered resource files in the skill directory */
  resources: z.object({
    /** Script files: scripts/*.ts, scripts/*.js, or top-level *.ts/*.js */
    scripts: z.array(z.string()).optional(),
    /** Reference docs: references/*.md */
    references: z.array(z.string()).optional(),
    /** Asset files: assets/* */
    assets: z.array(z.string()).optional(),
  }).optional(),

  // ─── WebSkills extension fields ────────────────────────────────────
  /** Whether this skill is a WebSkill (browser-side MCP tool) */
  webSkill: z.boolean().optional(),
  /** Associated MCP server name (for skill↔MCP bridging) */
  mcpServer: z.string().optional(),
  /** Associated frontend route (for SPA page-routing) */
  route: z.string().optional(),
  /** MCP tool names this skill uses or provides */
  tools: z.array(z.string()).optional(),
});
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

/**
 * SkillBundle — a self-contained skill package for browser/edge scenarios.
 *
 * Bundles SKILL.md content + script/reference/asset files as inline strings,
 * eliminating the need for a filesystem. Can be serialized to JSON for
 * IndexedDB storage, URL distribution, or inline import.
 */
export const SkillBundleSchema = z.object({
  /** Skill metadata (from SKILL.md frontmatter) */
  metadata: SkillMetadataSchema,
  /** Full SKILL.md content (markdown body, without frontmatter) */
  instructions: z.string(),
  /** Inline file contents keyed by relative path */
  files: z.record(z.string()).optional(),
});
export type SkillBundle = z.infer<typeof SkillBundleSchema>;

// ─── WebSkill Definition ─────────────────────────────────────────────

/**
 * WebSkillDefinition — describes a programmatically registered browser-side
 * tool for the WebSkillRuntime.
 *
 * This is the runtime representation used by `WebSkillRuntime.registerSkill()`.
 * Unlike SKILL.md (which is instruction-based), this is function-based:
 * the handler is a JS function, and the inputSchema is a JSON Schema object.
 */
export const WebSkillDefinitionSchema = z.object({
  /** Tool name (must be unique within a WebSkillRuntime) */
  name: z.string(),
  /** Human-readable description (shown to LLM for tool selection) */
  description: z.string(),
  /** JSON Schema describing the tool's input parameters */
  inputSchema: z.record(z.unknown()),
  /** Target route for SPA page-routing (optional) */
  route: z.string().optional(),
  /** Timeout for page-routed tool calls in ms (default: 30000) */
  timeout: z.number().optional(),
});
export type WebSkillDefinition = z.infer<typeof WebSkillDefinitionSchema>;
