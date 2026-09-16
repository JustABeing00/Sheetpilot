import {
  CorruptFileError,
  InvalidFileError,
  OversizedFileError,
  UnsupportedFormatError,
  type TabularFormat,
} from '@sheetpilot/core';

const CSV_EXTENSIONS = ['.csv', '.txt', '.tsv'];
const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'];
const LEGACY_EXCEL_EXTENSIONS = ['.xls', '.xlsb'];

const TABULAR_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
]);

const ZIP_MAGIC = [0x50, 0x4b];

export interface UploadCandidate {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  head?: Buffer | Uint8Array;
}

export interface ValidatedUpload {
  fileName: string;
  format: TabularFormat;
  mimeType: string;
}

function stripControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    result += character;
  }
  return result;
}

/**
 * Reduces an untrusted upload name to a safe basename: strips directory components (both separators),
 * control characters and NUL bytes. The result is used for display only; storage keys are generated
 * from internal ids and never from user input.
 */
export function sanitizeFileName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const cleaned = stripControlCharacters(base).trim();
  return cleaned.length > 0 ? cleaned : 'upload';
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

function isAllowedMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  return normalized.startsWith('text/') || TABULAR_MIME_TYPES.has(normalized);
}

function assertContentMatchesFormat(
  format: TabularFormat,
  fileName: string,
  head?: Uint8Array,
): void {
  if (head === undefined || head.length === 0) {
    return;
  }
  if (format === 'xlsx') {
    if (head.length < 2 || head[0] !== ZIP_MAGIC[0] || head[1] !== ZIP_MAGIC[1]) {
      throw new CorruptFileError(
        `"${fileName}" has the .xlsx extension but is not a valid workbook. Re-export the file or upload a CSV.`,
        { fileName },
      );
    }
    return;
  }
  const sample = head.subarray(0, 4096);
  if (sample.includes(0)) {
    throw new CorruptFileError(
      `"${fileName}" looks like a binary file rather than delimited text. Upload a .csv, .xlsx or .xlsm file.`,
      { fileName },
    );
  }
}

/**
 * Validates an upload before it is stored or parsed: extension allowlist, content type, size and a
 * cheap magic-byte check. Never trusts the caller's filename.
 */
export function validateUpload(
  candidate: UploadCandidate,
  options: { maxBytes: number },
): ValidatedUpload {
  const fileName = sanitizeFileName(candidate.fileName);
  const extension = extensionOf(fileName);

  if (LEGACY_EXCEL_EXTENSIONS.includes(extension)) {
    throw new UnsupportedFormatError(
      `Legacy Excel format "${extension}" is not supported. Save the workbook as .xlsx or .csv and upload it again.`,
      { fileName, extension },
    );
  }

  let format: TabularFormat;
  if (XLSX_EXTENSIONS.includes(extension)) {
    format = 'xlsx';
  } else if (CSV_EXTENSIONS.includes(extension)) {
    format = 'csv';
  } else {
    throw new UnsupportedFormatError(
      `Unsupported file type "${extension || fileName}". Upload a .csv, .xlsx or .xlsm file.`,
      { fileName, extension },
    );
  }

  if (!isAllowedMimeType(candidate.mimeType)) {
    throw new InvalidFileError(
      `The declared content type "${candidate.mimeType}" is not a tabular file type.`,
      { fileName, mimeType: candidate.mimeType },
    );
  }

  if (candidate.sizeBytes <= 0) {
    throw new InvalidFileError(`"${fileName}" is empty.`, { fileName });
  }

  if (candidate.sizeBytes > options.maxBytes) {
    throw new OversizedFileError(
      `"${fileName}" is ${candidate.sizeBytes} bytes, which exceeds the configured upload limit of ${options.maxBytes} bytes.`,
      { fileName, sizeBytes: candidate.sizeBytes, maxBytes: options.maxBytes },
    );
  }

  assertContentMatchesFormat(format, fileName, candidate.head);

  return {
    fileName,
    format,
    mimeType:
      candidate.mimeType.trim().length > 0 ? candidate.mimeType : 'application/octet-stream',
  };
}
