import { describe, it, expect, vi } from 'vitest';
import { SkillsMiddleware } from '../skills.js';
import type { BackendProtocol } from '@tdeepagents/backends';

describe('SkillsMiddleware - WebSkills Frontmatter', () => {
  const mockBackend = {
    readFile: vi.fn(),
    listDir: vi.fn(),
    exists: vi.fn(),
  } as unknown as BackendProtocol;

  it('should correctly parse WebSkills fields from SKILL.md frontmatter', async () => {
    const middleware = new SkillsMiddleware(['/skills']);

    const skillContent = `---
name: web-search
description: Search the web via browser tool
web-skill: true
mcp-server: google-search
route: /search
tools: search_web, open_url
---
Skill instructions here.`;

    // Access private method for testing
    const meta = (middleware as any).parseFrontmatter(skillContent, '/skills/web-search/SKILL.md');

    expect(meta).not.toBeNull();
    expect(meta.webSkill).toBe(true);
    expect(meta.mcpServer).toBe('google-search');
    expect(meta.route).toBe('/search');
    expect(meta.tools).toEqual(['search_web', 'open_url']);
  });

  it('should handle standard frontmatter without WebSkills fields', () => {
    const middleware = new SkillsMiddleware(['/skills']);

    const skillContent = `---
name: calculator
description: Basic math operations
---
Instructions.`;

    const meta = (middleware as any).parseFrontmatter(skillContent, '/skills/calc/SKILL.md');

    expect(meta).not.toBeNull();
    expect(meta.name).toBe('calculator');
    expect(meta.webSkill).toBeUndefined();
    expect(meta.mcpServer).toBeUndefined();
  });
});
