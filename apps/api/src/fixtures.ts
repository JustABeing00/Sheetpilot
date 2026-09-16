import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const samplesDir = new URL('../../../samples/account-faults/', import.meta.url);
const fieldServiceDir = new URL('../../../samples/field-service/', import.meta.url);

export const PRIMARY_CSV = readFileSync(
  fileURLToPath(new URL('primary_accounts.csv', samplesDir)),
  'utf8',
);
export const EVENTS_CSV = readFileSync(
  fileURLToPath(new URL('fault_events.csv', samplesDir)),
  'utf8',
);

// A second, independently created fixture set for the configuration-driven end-to-end journey.
export const SERVICE_SITES_CSV = readFileSync(
  fileURLToPath(new URL('service_sites.csv', fieldServiceDir)),
  'utf8',
);
export const SITE_FAULTS_CSV = readFileSync(
  fileURLToPath(new URL('site_faults.csv', fieldServiceDir)),
  'utf8',
);
