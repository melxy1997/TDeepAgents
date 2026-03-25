import { z } from 'zod';

/**
 * Skill metadata schema — follows the Agent Skills Specification
 * (https://agentskills.io/specification).
 *
 * Frontmatter fields from SKILL.md:
 * - name (required): skill identifier, lowercase a-z and hyphens
 * - description (required): what the skill does and when to use it
 * - license, compatibility, metadata, allowed-tools (optional)
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
