import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { conditionGroupSchema, ruleSchema, ruleSetSchema } from './rules.js';
import { formatZodError, parseOrThrow, ValidationError } from '../errors.js';

describe('ruleSchema', () => {
  it('applies defaults for optional fields', () => {
    const rule = ruleSchema.parse({
      id: 'r1',
      name: 'Power loss',
      when: { conditions: [{ field: 'description', operator: 'contains', value: 'no power' }] },
      then: [{ field: 'rootCause', value: 'Power Loss' }],
    });

    expect(rule.priority).toBe(0);
    expect(rule.enabled).toBe(true);
    expect(rule.confidence).toBe(1);
    expect(rule.when).toMatchObject({ mode: 'all' });
  });

  it('supports nested condition groups', () => {
    const group = conditionGroupSchema.parse({
      mode: 'any',
      conditions: [
        { field: 'a', operator: 'equals', value: 'x' },
        {
          mode: 'all',
          conditions: [
            { field: 'b', operator: 'contains', value: 'y' },
            { field: 'c', operator: 'is_not_empty' },
          ],
        },
      ],
    });

    expect(group.conditions).toHaveLength(2);
    expect(group.mode).toBe('any');
  });

  it('rejects rules without actions', () => {
    const result = ruleSetSchema.safeParse({
      slug: 'rs',
      workflowSlug: 'wf',
      name: 'Rule set',
      version: 1,
      rules: [{ id: 'r1', name: 'broken', when: { conditions: [] }, then: [] }],
    });

    expect(result.success).toBe(false);
  });
});

describe('parseOrThrow', () => {
  it('returns parsed values', () => {
    const parsed = parseOrThrow(z.object({ value: z.number() }), { value: 3 }, 'payload');
    expect(parsed.value).toBe(3);
  });

  it('throws a ValidationError with issue details', () => {
    expect(() =>
      parseOrThrow(z.object({ value: z.number() }), { value: 'nope' }, 'payload'),
    ).toThrow(ValidationError);

    try {
      parseOrThrow(z.object({ value: z.number() }), { value: 'nope' }, 'payload');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.statusCode).toBe(400);
      expect(formatZodError(validationError.details as never)).toBeDefined();
    }
  });
});
