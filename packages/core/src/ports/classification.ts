import { z } from 'zod';
import { classificationOptionSchema } from '../domain/entities.js';

export const classificationRequestSchema = z.object({
  text: z.string().min(1),
  accountKey: z.string().nullable().default(null),
  taxonomy: z.array(classificationOptionSchema).min(1),
  hints: z.record(z.string(), z.string()).default({}),
});
export type ClassificationRequest = z.infer<typeof classificationRequestSchema>;

export const classificationSuggestionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().default(''),
});
export type ClassificationSuggestion = z.infer<typeof classificationSuggestionSchema>;

export interface ClassificationProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): boolean;
  classify(
    request: ClassificationRequest,
    signal?: AbortSignal,
  ): Promise<ClassificationSuggestion[]>;
}
