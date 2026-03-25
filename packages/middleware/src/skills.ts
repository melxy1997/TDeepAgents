import type { Middleware, Runtime } from './types.js';
import type { AgentState } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';
import type { SkillMetadata } from '@tdeepagents/schemas';

/**
 * SkillsMiddleware — progressive disclosure of skills.
 *
 * At startup: reads SKILL.md frontmatter from configured paths.
 * On-demand: loads full skill content when the agent determines it's useful.
 * Follows the Agent Skills standard (https://agentskills.io/).
 */
export class SkillsMiddleware implements Middleware {
  name = 'skills';
  private skillPaths: string[];
  private loadedMetadata: SkillMetadata[] = [];

  constructor(skillPaths: string[]) {
    this.skillPaths = skillPaths;
  }

  async beforeAgent(state: AgentState, runtime: Runtime): Promise<Partial<AgentState> | void> {
    if (this.loadedMetadata.length > 0) return; // already loaded

    const backend = runtime.backend as BackendProtocol;

    for (const skillPath of this.skillPaths) {
      try {
        const entries = await backend.lsInfo(skillPath);
        for (const entry of entries) {
          if (entry.isDir) {
            // Look for SKILL.md in subdirectory
            const skillMdPath = `${entry.path}SKILL.md`;
            const content = await backend.read(skillMdPath);
            if (!content.startsWith('Error:')) {
              const metadata = this.parseFrontmatter(content, skillMdPath);
              if (metadata) {
                this.loadedMetadata.push(metadata);
              }
            }
          }
        }
      } catch {
        // Skill path doesn't exist — skip
      }
    }

    // Inject skills metadata into a system-level instruction
    if (this.loadedMetadata.length > 0) {
      const skillsList = this.loadedMetadata
        .map((s) => `- **${s.name}**: ${s.description} (read from: ${s.path})`)
        .join('\n');

      const currentMessages = state.messages;
      const skillsMessage = {
        role: 'system' as const,
        content:
          `Available skills (use read_file to load full skill content when needed):\n${skillsList}`,
      };

      return {
        messages: [skillsMessage, ...currentMessages],
      };
    }
  }

  private parseFrontmatter(content: string, path: string): SkillMetadata | null {
    // Simple YAML frontmatter parser for SKILL.md files
    // Expected format:
    // ---
    // name: skill-name
    // description: what this skill does
    // ---
    const lines = content.split('\n').map((l) => l.replace(/^\d+:\s/, '')); // remove line numbers
    const frontmatterStart = lines.indexOf('---');
    if (frontmatterStart === -1) return null;

    const frontmatterEnd = lines.indexOf('---', frontmatterStart + 1);
    if (frontmatterEnd === -1) return null;

    const frontmatter = lines.slice(frontmatterStart + 1, frontmatterEnd);
    let name = '';
    let description = '';

    for (const line of frontmatter) {
      const nameMatch = line.match(/^name:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();
      const descMatch = line.match(/^description:\s*(.+)/);
      if (descMatch) description = descMatch[1].trim();
    }

    if (!name) return null;

    return { name, description: description || name, path };
  }
}
