import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20261119150000_approval_request_schema_alignment.sql', import.meta.url),
  'utf8',
);

test('approval schema migration adds the fields used by the workforce approval service', () => {
  assert.match(migration, /add column if not exists resolution_note text/i);
  assert.match(migration, /add column if not exists subject_type text/i);
  assert.match(migration, /add column if not exists subject_id text/i);
  assert.match(migration, /set resolution_note = decision_note/i);
  assert.match(migration, /organization_approval_requests_subject_idx/i);
  assert.match(migration, /organization_approval_requests_task_idx/i);
});
