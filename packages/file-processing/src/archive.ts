import { CorruptFileError } from '@sheetpilot/core';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP64_UINT32_MAX = 0xffffffff;

export interface ZipArchiveSummary {
  entryCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  /** True when the archive uses ZIP64 records; per-entry sizes are then not summed here. */
  zip64: boolean;
}

export interface WorkbookArchiveLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
}

/**
 * Reads the ZIP central directory of an (already buffered) `.xlsx`/`.xlsm` upload without inflating
 * anything. Returns `null` when the structure cannot be read (the reader will surface a clearer error).
 * This is deliberately tolerant: it must never throw on untrusted bytes, only report what it can see.
 */
export function readZipArchiveSummary(buffer: Buffer): ZipArchiveSummary | null {
  if (buffer.length < 22) {
    return null;
  }

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    return null;
  }

  let entryCount: number;
  let directoryOffset: number;
  try {
    entryCount = buffer.readUInt16LE(eocd + 10);
    directoryOffset = buffer.readUInt32LE(eocd + 16);
  } catch {
    return null;
  }

  if (directoryOffset >= buffer.length) {
    return null;
  }

  let position = directoryOffset;
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  let entriesRead = 0;
  const maxEntries = Math.min(entryCount, 100_000);

  while (entriesRead < maxEntries && position + 46 <= buffer.length) {
    let signature: number;
    try {
      signature = buffer.readUInt32LE(position);
    } catch {
      break;
    }
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }

    let compressed: number;
    let uncompressed: number;
    let nameLength: number;
    let extraLength: number;
    let commentLength: number;
    try {
      compressed = buffer.readUInt32LE(position + 20);
      uncompressed = buffer.readUInt32LE(position + 24);
      nameLength = buffer.readUInt16LE(position + 28);
      extraLength = buffer.readUInt16LE(position + 30);
      commentLength = buffer.readUInt16LE(position + 32);
    } catch {
      return null;
    }

    if (compressed === ZIP64_UINT32_MAX || uncompressed === ZIP64_UINT32_MAX) {
      const sizes = readZip64Sizes(buffer, position + 46 + nameLength, extraLength);
      if (!sizes) {
        // Unknown ZIP64 sizes: stop summing and flag it so callers apply only the entry cap.
        return {
          entryCount,
          compressedBytes,
          uncompressedBytes,
          zip64: true,
        };
      }
      compressed = sizes.compressed;
      uncompressed = sizes.uncompressed;
    }

    if (Number.isFinite(compressed) && uncompressed >= 0) {
      compressedBytes += compressed;
      uncompressedBytes += uncompressed;
    }

    entriesRead += 1;
    const advance = 46 + nameLength + extraLength + commentLength;
    if (advance <= 0 || position + advance > buffer.length) {
      break;
    }
    position += advance;
  }

  return { entryCount, compressedBytes, uncompressedBytes, zip64: false };
}

function readZip64Sizes(
  buffer: Buffer,
  extraStart: number,
  extraLength: number,
): { compressed: number; uncompressed: number } | null {
  let position = extraStart;
  const end = Math.min(extraStart + extraLength, buffer.length);
  while (position + 4 <= end) {
    const headerId = buffer.readUInt16LE(position);
    const dataSize = buffer.readUInt16LE(position + 2);
    const dataStart = position + 4;
    if (headerId === ZIP64_EXTRA_FIELD_ID && dataStart + 16 <= buffer.length) {
      try {
        const uncompressed = Number(buffer.readBigUInt64LE(dataStart));
        const compressed = Number(buffer.readBigUInt64LE(dataStart + 8));
        return { uncompressed, compressed };
      } catch {
        return null;
      }
    }
    if (dataSize <= 0) {
      return null;
    }
    position = dataStart + dataSize;
  }
  return null;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

/**
 * Rejects a workbook whose ZIP directory advertises far more content than the configured ceiling (a
 * zip-bomb / decompression-bomb guard). Legitimate Excel files are well under these limits. ZIP64
 * archives skip the size test because their per-entry sizes are not always resolvable here.
 */
export function assertWorkbookArchiveSafe(
  buffer: Buffer,
  fileName: string,
  limits: WorkbookArchiveLimits,
): void {
  const summary = readZipArchiveSummary(buffer);
  if (!summary) {
    return;
  }

  if (summary.entryCount > limits.maxEntries) {
    throw new CorruptFileError(
      `"${fileName}" contains ${summary.entryCount} archive entries, which exceeds the limit of ${limits.maxEntries}.`,
      { fileName, entryCount: summary.entryCount, maxEntries: limits.maxEntries },
    );
  }

  if (!summary.zip64 && summary.uncompressedBytes > limits.maxUncompressedBytes) {
    throw new CorruptFileError(
      `"${fileName}" expands to ${summary.uncompressedBytes} bytes, which exceeds the configured workbook limit of ${limits.maxUncompressedBytes} bytes.`,
      {
        fileName,
        uncompressedBytes: summary.uncompressedBytes,
        maxUncompressedBytes: limits.maxUncompressedBytes,
      },
    );
  }
}
