import type { Middleware, Runtime } from './types.js';
import type { AgentState } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';
import type { SkillMetadata, SkillBundle } from '@tdeepagents/schemas';

/**
 * SkillsMiddleware — progressive disclosure of Agent Skills.
 *
 * Follows the Agent Skills Specification (https://agentskills.io/specification).
 *
 * Skill loading flow:
 * 1. Startup: scan skill directories, parse SKILL.md frontmatter (~100 tokens each)
 * 2. Inject: append skill metadata list to system prompt
 * 3. On-demand: agent reads full SKILL.md via read_file when needed
 * 4. Resources: agent reads scripts/references/assets as needed
 *
 * Supports 3 skill sources:
 * - **Directory skills**: traditional SKILL.md + optional directories (Node/filesystem)
 * - **SkillBundle JSON**: self-contained inline packages (browser/edge)
 * - **URL install**: fetch SKILL.md from URL and write to backend (any runtime)
 *
 * Source precedence: later skill paths override earlier ones (same name → last wins).
 */
export class SkillsMiddleware implements Middleware {
  name = 'skills';
  private skillPaths: string[];
  private bundles: SkillBundle[];
  private loadedSkills: Map<string, SkillMetadata> = new Map(); // name → metadata (deduped)
  private loaded = false;

  constructor(
    skillPaths: string[] = [],
    options?: { bundles?: SkillBundle[] },
  ) {
    this.skillPaths = skillPaths;
    this.bundles = options?.bundles ?? [];
  }

  async beforeAgent(state: AgentState, runtime: Runtime): Promise<Partial<AgentState> | void> {
    if (this.loaded) return;
    this.loaded = true;

    const backend = runtime.backend as BackendProtocol;

    // 1. Load directory-based skills (from backend filesystem)
    for (const skillPath of this.skillPaths) {
      await this.loadDirectorySkills(backend, skillPath);
    }

    // 2. Load SkillBundle inline skills (browser/edge)
    for (const bundle of this.bundles) {
      this.loadBundleSkill(bundle, backend);
    }

    // 3. Inject skill metadata into system prompt
    if (this.loadedSkills.size === 0) return;

    const skillsList = [...this.loadedSkills.values()]
      .map((s) => {
        let entry = `- **${s.name}**: ${s.description}`;
        if (s.path) entry += ` (read from: \`${s.path}\`)`;
        if (s.allowedTools?.length) entry += ` [tools: ${s.allowedTools.join(', ')}]`;
        if (s.resources?.scripts?.length) {
          entry += `\n  Scripts: ${s.resources.scripts.map(p => `\`${p}\``).join(', ')}`;
        }
        return entry;
      })
      .join('\n');

    const skillsMessage = {
      role: 'system' as const,
      content: `# Available Skills\n\nThe following skills are available. To use a skill, read its full SKILL.md file for detailed instructions.\n\n${skillsList}`,
    };

    return {
      messages: [skillsMessage, ...state.messages],
    };
  }

  // ─── Directory-based skill loading ──────────────────────────────────

  private async loadDirectorySkills(backend: BackendProtocol, basePath: string): Promise<void> {
    try {
      const entries = await backend.lsInfo(basePath);
      for (const entry of entries) {
        if (!entry.isDir) continue;

        const skillDir = entry.path.endsWith('/') ? entry.path : `${entry.path}/`;
        const skillMdPath = `${skillDir}SKILL.md`;
        const content = await backend.read(skillMdPath);

        if (content.startsWith('Error:')) continue;

        const metadata = this.parseFrontmatter(content, skillMdPath);
        if (!metadata) continue;

        // Discover resource files
        metadata.resources = await this.discoverResources(backend, skillDir);

        // Source precedence: later paths override earlier ones
        this.loadedSkills.set(metadata.name, metadata);
      }
    } catch {
      // Skill path doesn't exist — skip
    }
  }

  // ─── Resource discovery ─────────────────────────────────────────────

  private async discoverResources(
    backend: BackendProtocol,
    skillDir: string,
  ): Promise<SkillMetadata['resources']> {
    const resources: NonNullable<SkillMetadata['resources']> = {};

    // Discover scripts/ directory and top-level .ts/.js files
    const scripts: string[] = [];
    try {
      const scriptEntries = await backend.lsInfo(`${skillDir}scripts`);
      for (const e of scriptEntries) {
        if (!e.isDir && (e.path.endsWith('.ts') || e.path.endsWith('.js'))) {
          scripts.push(e.path);
        }
      }
    } catch { /* no scripts/ dir */ }

    // Also check top-level script files (like arxiv_search.ts)
    try {
      const dirEntries = await backend.lsInfo(skillDir);
      for (const e of dirEntries) {
        if (!e.isDir && e.path !== `${skillDir}SKILL.md` &&
            (e.path.endsWith('.ts') || e.path.endsWith('.js'))) {
          scripts.push(e.path);
        }
      }
    } catch { /* skip */ }

    if (scripts.length) resources.scripts = scripts;

    // Discover references/ directory
    try {
      const refEntries = await backend.lsInfo(`${skillDir}references`);
      const refs = refEntries.filter(e => !e.isDir && e.path.endsWith('.md')).map(e => e.path);
      if (refs.length) resources.references = refs;
    } catch { /* no references/ dir */ }

    // Discover assets/ directory
    try {
      const assetEntries = await backend.lsInfo(`${skillDir}assets`);
      const assets = assetEntries.filter(e => !e.isDir).map(e => e.path);
      if (assets.length) resources.assets = assets;
    } catch { /* no assets/ dir */ }

    return resources;
  }

  // ─── SkillBundle loading (browser/edge) ─────────────────────────────

  private loadBundleSkill(bundle: SkillBundle, backend: BackendProtocol): void {
    const { metadata, instructions, files } = bundle;
    const skillDir = `/skills/${metadata.name}/`;

    // Write SKILL.md to backend so agent can read it normally
    const fullContent = this.buildSkillMd(metadata, instructions);
    backend.write(`${skillDir}SKILL.md`, fullContent).catch(() => {});

    // Write inline files to backend
    if (files) {
      for (const [relativePath, content] of Object.entries(files)) {
        backend.write(`${skillDir}${relativePath}`, content).catch(() => {});
      }

      // Build resource listing from inline files
      const scripts = Object.keys(files).filter(p => p.endsWith('.ts') || p.endsWith('.js'))
        .map(p => `${skillDir}${p}`);
      const references = Object.keys(files).filter(p => p.startsWith('references/') && p.endsWith('.md'))
        .map(p => `${skillDir}${p}`);
      const assets = Object.keys(files).filter(p => p.startsWith('assets/'))
        .map(p => `${skillDir}${p}`);

      metadata.resources = {
        ...(scripts.length ? { scripts } : {}),
        ...(references.length ? { references } : {}),
        ...(assets.length ? { assets } : {}),
      };
    }

    metadata.path = `${skillDir}SKILL.md`;

    // Source precedence: bundles loaded after directories, so they override
    this.loadedSkills.set(metadata.name, metadata);
  }

  private buildSkillMd(metadata: SkillMetadata, instructions: string): string {
    let frontmatter = `---\nname: ${metadata.name}\ndescription: ${metadata.description}\n`;
    if (metadata.license) frontmatter += `license: ${metadata.license}\n`;
    if (metadata.compatibility) frontmatter += `compatibility: ${metadata.compatibility}\n`;
    if (metadata.allowedTools?.length) {
      frontmatter += `allowed-tools: ${metadata.allowedTools.join(', ')}\n`;
    }
    if (metadata.metadata) {
      frontmatter += 'metadata:\n';
      for (const [k, v] of Object.entries(metadata.metadata)) {
        frontmatter += `  ${k}: ${v}\n`;
      }
    }
    frontmatter += '---\n\n';
    return frontmatter + instructions;
  }

  // ─── Frontmatter parser ─────────────────────────────────────────────

  private parseFrontmatter(content: string, path: string): SkillMetadata | null {
    const lines = content.split('\n').map((l) => l.replace(/^\d+:\s/, '')); // remove line numbers
    const frontmatterStart = lines.indexOf('---');
    if (frontmatterStart === -1) return null;

    const frontmatterEnd = lines.indexOf('---', frontmatterStart + 1);
    if (frontmatterEnd === -1) return null;

    const frontmatter = lines.slice(frontmatterStart + 1, frontmatterEnd);
    let name = '';
    let description = '';
    let license: string | undefined;
    let compatibility: string | undefined;
    let allowedTools: string[] | undefined;
    const metadata: Record<string, string> = {};
    let inMetadata = false;

    // WebSkills extension fields
    let webSkill: boolean | undefined;
    let mcpServer: string | undefined;
    let route: string | undefined;
    let tools: string[] | undefined;

    for (const line of frontmatter) {
      if (line.startsWith('  ') && inMetadata) {
        const kvMatch = line.match(/^\s+(\w[\w-]*):\s*"?(.+?)"?\s*$/);
        if (kvMatch) metadata[kvMatch[1]] = kvMatch[2];
        continue;
      }
      inMetadata = false;

      const nameMatch = line.match(/^name:\s*(.+)/);
      if (nameMatch) { name = nameMatch[1].trim(); continue; }

      const descMatch = line.match(/^description:\s*(.+)/);
      if (descMatch) { description = descMatch[1].trim(); continue; }

      const licenseMatch = line.match(/^license:\s*(.+)/);
      if (licenseMatch) { license = licenseMatch[1].trim(); continue; }

      const compatMatch = line.match(/^compatibility:\s*(.+)/);
      if (compatMatch) { compatibility = compatMatch[1].trim(); continue; }

      const toolsMatch = line.match(/^allowed-tools:\s*(.+)/);
      if (toolsMatch) {
        allowedTools = toolsMatch[1].split(/[,\s]+/).filter(Boolean);
        continue;
      }

      // ─── WebSkills extension fields ──────────────────────────────
      const webSkillMatch = line.match(/^web-skill:\s*(.+)/);
      if (webSkillMatch) {
        webSkill = webSkillMatch[1].trim().toLowerCase() === 'true';
        continue;
      }

      const mcpServerMatch = line.match(/^mcp-server:\s*(.+)/);
      if (mcpServerMatch) { mcpServer = mcpServerMatch[1].trim(); continue; }

      const routeMatch = line.match(/^route:\s*(.+)/);
      if (routeMatch) { route = routeMatch[1].trim(); continue; }

      const skillToolsMatch = line.match(/^tools:\s*(.+)/);
      if (skillToolsMatch) {
        tools = skillToolsMatch[1].split(/[,\s]+/).filter(Boolean);
        continue;
      }

      if (line.match(/^metadata:\s*$/)) { inMetadata = true; }
    }

    if (!name) return null;

    return {
      name,
      description: description || name,
      path,
      license,
      compatibility,
      allowedTools,
      metadata: Object.keys(metadata).length ? metadata : undefined,
      webSkill,
      mcpServer,
      route,
      tools,
    };
  }
}

// ─── Utility: Install skill from URL ──────────────────────────────────

/**
 * Fetch a SKILL.md from a URL and install it into the backend.
 * Works in both Node.js and browser environments.
 *
 * @example
 * ```ts
 * await installSkillFromUrl(
 *   'https://raw.githubusercontent.com/langchain-ai/deepagentsjs/main/examples/skills/arxiv-search/',
 *   ['SKILL.md', 'arxiv_search.ts'],
 *   backend,
 * );
 * ```
 */
export async function installSkillFromUrl(
  baseUrl: string,
  files: string[],
  backend: BackendProtocol,
  targetDir?: string,
): Promise<SkillMetadata | null> {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  // First, fetch SKILL.md to extract the name
  const skillMdUrl = `${normalizedBaseUrl}SKILL.md`;
  const response = await fetch(skillMdUrl);
  if (!response.ok) throw new Error(`Failed to fetch ${skillMdUrl}: ${response.status}`);

  const skillMdContent = await response.text();

  // Parse name from frontmatter
  const nameMatch = skillMdContent.match(/^name:\s*(.+)$/m);
  const skillName = nameMatch?.[1]?.trim();
  if (!skillName) throw new Error('SKILL.md is missing the name field');

  const skillDir = targetDir ?? `/skills/${skillName}/`;

  // Write SKILL.md
  await backend.write(`${skillDir}SKILL.md`, skillMdContent);

  // Fetch and write additional files
  for (const file of files) {
    if (file === 'SKILL.md') continue; // already handled
    try {
      const fileUrl = `${normalizedBaseUrl}${file}`;
      const fileResp = await fetch(fileUrl);
      if (fileResp.ok) {
        const content = await fileResp.text();
        await backend.write(`${skillDir}${file}`, content);
      }
    } catch {
      // Skip files that fail to fetch
    }
  }

  return {
    name: skillName,
    description: skillMdContent.match(/^description:\s*(.+)$/m)?.[1]?.trim() || skillName,
    path: `${skillDir}SKILL.md`,
  };
}

/**
 * Convert a directory-based skill (from backend) into a self-contained SkillBundle.
 * Useful for exporting skills or migrating Node→Browser.
 */
export async function createSkillBundle(
  skillDir: string,
  backend: BackendProtocol,
): Promise<SkillBundle | null> {
  const skillMdPath = `${skillDir}SKILL.md`;
  const content = await backend.read(skillMdPath);
  if (content.startsWith('Error:')) return null;

  const rawLines = content.split('\n').map((l) => l.replace(/^\d+:\s/, ''));

  // Parse frontmatter
  const fmStart = rawLines.indexOf('---');
  const fmEnd = rawLines.indexOf('---', fmStart + 1);
  if (fmStart === -1 || fmEnd === -1) return null;

  const instructions = rawLines.slice(fmEnd + 1).join('\n').trim();

  // Parse metadata
  const fmLines = rawLines.slice(fmStart + 1, fmEnd);
  let name = '';
  let description = '';
  for (const line of fmLines) {
    const nm = line.match(/^name:\s*(.+)/);
    if (nm) name = nm[1].trim();
    const dm = line.match(/^description:\s*(.+)/);
    if (dm) description = dm[1].trim();
  }
  if (!name) return null;

  // Scan directory for all files
  const files: Record<string, string> = {};
  const entries = await backend.lsInfo(skillDir);
  for (const entry of entries) {
    if (entry.isDir || entry.path.endsWith('SKILL.md')) continue;
    const relativePath = entry.path.replace(skillDir, '');
    const fileContent = await backend.read(entry.path, 0, 10000);
    // Remove line numbers added by backend.read
    const cleanContent = fileContent.split('\n')
      .map(l => l.replace(/^\d+:\s/, ''))
      .join('\n');
    files[relativePath] = cleanContent;
  }

  return {
    metadata: {
      name,
      description: description || name,
      path: skillMdPath,
    },
    instructions,
    ...(Object.keys(files).length ? { files } : {}),
  };
}
