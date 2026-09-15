import type { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { cellToString, type CellValue, type Row } from '../table.js';
import type { ReadOptions, TabularReader } from './tabular-reader.js';

function excelValueToCellValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') {
    return null;
  }
  if ('result' in value) {
    return excelValueToCellValue(value.result);
  }
  if ('richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value) {
    return value.text;
  }
  if ('error' in value) {
    return null;
  }
  return null;
}

export class XlsxTabularReader implements TabularReader {
  readonly format = 'xlsx' as const;

  async *read(source: Readable, options: ReadOptions = {}): AsyncGenerator<Row> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(source);

    const worksheet = options.sheetName
      ? workbook.getWorksheet(options.sheetName)
      : workbook.worksheets[0];

    if (!worksheet) {
      return;
    }

    const headerRow = worksheet.getRow(1);
    const columnByIndex = new Map<number, string>();
    headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const name = cellToString(excelValueToCellValue(cell.value)).trim();
      if (name.length > 0) {
        columnByIndex.set(columnNumber, name);
      }
    });

    const collected: Row[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1 || options.signal?.aborted) {
        return;
      }
      if (options.limit !== undefined && collected.length >= options.limit) {
        return;
      }
      const record: Row = {};
      for (const [index, name] of columnByIndex) {
        record[name] = excelValueToCellValue(row.getCell(index).value);
      }
      collected.push(record);
    });

    for (const row of collected) {
      yield row;
    }
  }
}
