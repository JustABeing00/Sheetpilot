import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const samplesDir = new URL('../../../samples/account-faults/', import.meta.url);

export const PRIMARY_CSV = readFileSync(
  fileURLToPath(new URL('primary_accounts.csv', samplesDir)),
  'utf8',
);
export const EVENTS_CSV = readFileSync(
  fileURLToPath(new URL('fault_events.csv', samplesDir)),
  'utf8',
);
