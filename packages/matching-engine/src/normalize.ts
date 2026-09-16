import type {
  IdentifierNormalizationOptions,
  IdentifierTransformation,
  IdentifierTransformationCode,
  NormalizedIdentifier,
} from './types.js';

const DEFAULT_OPTIONS: Required<IdentifierNormalizationOptions> = {
  normalizeNonBreakingSpace: true,
  trim: true,
  collapseWhitespace: true,
  upperCase: true,
  stripSeparators: false,
  stripLeadingZeros: false,
};

const SEPARATOR_PATTERN = /[\s\-_./\\]+/g;

/** Renders any cell-like value as text without changing its meaning. */
export function renderCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  // Cell values are strings, numbers, booleans or dates; anything else is out of contract and blank.
  return '';
}

/**
 * Derives a comparison key from a raw identifier.
 *
 * The default options reproduce `normalizeKey` from `@sheetpilot/file-processing` exactly
 * (non-breaking space, trim, whitespace collapse, upper case), so matching stays consistent with
 * ingestion and classification. Every step that actually changes the value is reported in
 * `transformations`; steps that could merge genuinely distinct identifiers (separator and
 * leading-zero removal) are disabled by default and flagged `dangerous` when enabled.
 */
export function normalizeIdentifier(
  value: unknown,
  options: IdentifierNormalizationOptions = {},
): NormalizedIdentifier {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const transformations: IdentifierTransformation[] = [];
  const record = (code: IdentifierTransformationCode, dangerous: boolean): void => {
    transformations.push({ code, dangerous });
  };

  const raw = renderCellText(value);
  if (raw.length === 0) {
    return { raw: '', key: '', transformations, dangerous: false };
  }

  // Non-string cells are never text-mangled: numbers/booleans are stringified and dates are ISO.
  if (typeof value === 'number') {
    record('coerce-number', false);
    return { raw, key: raw, transformations, dangerous: false };
  }
  if (typeof value === 'boolean' || value instanceof Date) {
    return { raw, key: raw, transformations, dangerous: false };
  }

  let working = raw;

  if (opts.normalizeNonBreakingSpace && working.includes('\u00a0')) {
    working = working.replace(/\u00a0/g, ' ');
    record('normalize-non-breaking-space', false);
  }
  if (opts.trim) {
    const trimmed = working.trim();
    if (trimmed !== working) {
      working = trimmed;
      record('trim', false);
    }
  }
  if (opts.collapseWhitespace) {
    const collapsed = working.replace(/\s+/g, ' ');
    if (collapsed !== working) {
      working = collapsed;
      record('collapse-whitespace', false);
    }
  }
  if (opts.stripSeparators) {
    const stripped = working.replace(SEPARATOR_PATTERN, '');
    if (stripped !== working) {
      working = stripped;
      record('strip-separators', true);
    }
  }
  if (opts.stripLeadingZeros && /^0\d/.test(working)) {
    const stripped = working.replace(/^0+(?=\d)/, '');
    if (stripped !== working) {
      working = stripped;
      record('strip-leading-zeros', true);
    }
  }
  if (opts.upperCase) {
    const upper = working.toUpperCase();
    if (upper !== working) {
      working = upper;
      record('upper-case', false);
    }
  }

  return {
    raw,
    key: working,
    transformations,
    dangerous: transformations.some((entry) => entry.dangerous),
  };
}

export function hasDangerousTransformation(
  transformations: readonly IdentifierTransformation[],
): boolean {
  return transformations.some((entry) => entry.dangerous);
}
