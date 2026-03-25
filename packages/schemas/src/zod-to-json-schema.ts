import type { z } from 'zod';

/**
 * Convert a Zod schema to a JSON Schema object.
 *
 * Handles common Zod types: object, string, number, boolean, array, enum,
 * optional, default, record, literal, union. For production use with complex
 * schemas consider the `zod-to-json-schema` package.
 *
 * This is the single shared implementation used by all LLM adapters and
 * the Chrome Built-in AI adapter's `responseConstraint`.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertNode(schema);
}

function convertNode(schema: any): Record<string, unknown> {
  if (!schema || !schema._def) {
    return { type: 'object', properties: {} };
  }

  const def = schema._def;
  const desc = def.description ? { description: def.description } : {};

  switch (def.typeName) {
    case 'ZodObject': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const shape = schema.shape;
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convertNode(value as any);
        if ((value as any)?._def?.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }
      return {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        ...desc,
      };
    }

    case 'ZodString':
      return { type: 'string', ...desc };

    case 'ZodNumber':
      return { type: 'number', ...desc };

    case 'ZodBoolean':
      return { type: 'boolean', ...desc };

    case 'ZodArray':
      return { type: 'array', items: convertNode(def.type), ...desc };

    case 'ZodEnum':
      return { type: 'string', enum: def.values, ...desc };

    case 'ZodLiteral':
      return { const: def.value, ...desc };

    case 'ZodOptional':
      return convertNode(def.innerType);

    case 'ZodNullable': {
      const inner = convertNode(def.innerType);
      return { ...inner, nullable: true };
    }

    case 'ZodDefault':
      return { ...convertNode(def.innerType), default: def.defaultValue() };

    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: convertNode(def.valueType),
        ...desc,
      };

    case 'ZodUnion': {
      const options = (def.options as any[]).map(convertNode);
      return { anyOf: options, ...desc };
    }

    case 'ZodTuple': {
      const items = (def.items as any[]).map(convertNode);
      return { type: 'array', prefixItems: items, ...desc };
    }

    default:
      return { type: 'string', ...desc };
  }
}
