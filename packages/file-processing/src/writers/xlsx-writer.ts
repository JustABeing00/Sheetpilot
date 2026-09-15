import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { CellValue, Row } from '../table.js';
import type { TabularWriter, WriteOptions, WriteResult } from './tabular-writer.js';

function toExcelValue(value: CellValue | undefined): ExcelJS.CellValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return { richText: [{ text: value }] };
  }
  return value;
}

export class XlsxTabularWriter implements TabularWriter {
  readonly format = 'xlsx' as const;

  async write(
    rows: Iterable<Row> | AsyncIterable<Row>,
    sink: Writable,
    options: WriteOptions,
  ): Promise<WriteResult> {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(options.sheetName ?? 'Output');

    const header = worksheet.addRow(options.columns);
    header.font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    let rowCount = 0;
    for await (const row of rows as AsyncIterable<Row>) {
      if (options.signal?.aborted) {
        break;
      }
      worksheet.addRow(options.columns.map((column) => toExcelValue(row[column])));
      rowCount += 1;
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: options.columns.length },
    };

    await workbook.xlsx.write(sink);
    return { rowCount, columns: options.columns };
  }
}
