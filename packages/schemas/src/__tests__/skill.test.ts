import { describe, it, expect } from 'vitest';
import { SkillMetadataSchema, WebSkillDefinitionSchema } from '../skill.js';

describe('Skill Metadata Schema', () => {
  it('should validate valid skill metadata with WebSkills extensions', () => {
    const validMeta = {
      name: 'flight-search',
      description: 'Search for flights',
      path: '/skills/flight-search/SKILL.md',
      webSkill: true,
      mcpServer: 'travel-api',
      route: '/search',
      tools: ['search_flights', 'get_booking_details']
    };
    
    const result = SkillMetadataSchema.safeParse(validMeta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.webSkill).toBe(true);
      expect(result.data.mcpServer).toBe('travel-api');
    }
  });

  it('should be backward compatible with standard skill metadata', () => {
    const legacyMeta = {
      name: 'text-utils',
      description: 'Utilities for text',
      path: '/skills/text-utils/SKILL.md',
      license: 'MIT'
    };
    
    const result = SkillMetadataSchema.safeParse(legacyMeta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.webSkill).toBeUndefined();
    }
  });
});

describe('WebSkill Definition Schema', () => {
  it('should validate valid web skill definition', () => {
    const validDef = {
      name: 'get_weather',
      description: 'Gets current weather',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' }
        }
      },
      route: '/weather',
      timeout: 5000
    };
    
    const result = WebSkillDefinitionSchema.safeParse(validDef);
    expect(result.success).toBe(true);
  });

  it('should fail on invalid definition', () => {
    const invalidDef = {
      name: 123, // should be string
      description: 'test'
    };
    
    const result = WebSkillDefinitionSchema.safeParse(invalidDef);
    expect(result.success).toBe(false);
  });
});
