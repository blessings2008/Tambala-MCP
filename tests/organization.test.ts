import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOrganization } from '../src/organization/seed.js';
import { validateOrganization } from '../src/organization/validate.js';
import { authorizeOrganizationalAction } from '../src/organization/policy.js';
import { getOrganizationSummary } from '../src/organization/service.js';
import { getRequestPrincipal, runWithRequestPrincipal } from '../src/organization/request-context.js';

const role = (id: string) => {
  const found = initialOrganization.roles.find((candidate) => candidate.id === id);
  assert.ok(found, `Expected seed role ${id} to exist`);
  return found;
};

test('initial organization seed is structurally valid', () => {
  assert.deepEqual(validateOrganization(initialOrganization), []);
});

test('the complete initial blueprint includes all core departments and business units', () => {
  const departments = initialOrganization.units.filter((unit) => unit.kind === 'department');
  const divisions = initialOrganization.units.filter((unit) => unit.kind === 'division');
  const businessUnits = initialOrganization.units.filter((unit) => unit.kind === 'business_unit');

  assert.equal(divisions.length, 4);
  assert.equal(departments.length, 18);
  assert.equal(businessUnits.length, 3);
  assert.ok(departments.find((unit) => unit.id === 'research-intelligence')?.parentId === null);
  assert.ok(departments.filter((unit) => unit.id !== 'research-intelligence').every((unit) => unit.parentId));
});

test('organization summary reports the expected leadership and planned units', () => {
  const summary = getOrganizationSummary();
  assert.equal(summary.name, 'Tambala Organization');
  assert.equal(summary.leadership.ceoRoleId, 'ceo');
  assert.equal(summary.validation.valid, true);
  assert.ok(summary.units.some((unit) => unit.id === 'research-intelligence'));
  assert.ok(summary.units.some((unit) => unit.id === 'fintech-ventures'));
});

test('unknown actor is denied', () => {
  const result = authorizeOrganizationalAction({
    actorRole: null,
    action: 'coordinate_work',
  });
  assert.equal(result.allowed, false);
});

test('CEO can coordinate work within delegated capability', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'coordinate_work',
  });
  assert.equal(result.allowed, true);
});

test('CEO cannot launch a major venture without recorded Founder approval', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'launch_major_venture',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.requiredAuthority, 'founder');
});

test('CEO can pass the launch policy only with a Founder approval record', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'launch_major_venture',
    approval: {
      authority: 'founder',
      approved: true,
      approvalId: 'approval-test-001',
    },
  });
  assert.equal(result.allowed, true);
});

test('approval does not grant a role a capability it does not have', () => {
  const council = role('executive-council');
  const result = authorizeOrganizationalAction({
    actorRole: council,
    action: 'launch_major_venture',
    approval: {
      authority: 'founder',
      approved: true,
      approvalId: 'approval-test-002',
    },
  });
  assert.equal(result.allowed, false);
});

test('only Founder can resolve Founder approval requests', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'resolve_founder_approval',
  });
  assert.equal(result.allowed, false);
});

test('structural validator detects duplicate IDs and missing references', () => {
  const broken = structuredClone(initialOrganization);
  broken.units.push({ ...broken.units[0], name: 'Duplicate ID unit' });
  broken.roles[1].reportsToRoleId = 'missing-role';
  const errors = validateOrganization(broken);
  assert.ok(errors.some((error) => error.includes('Duplicate unit id')));
  assert.ok(errors.some((error) => error.includes('reports to missing role')));
});


test('request identity context defaults to unknown outside an authenticated request', () => {
  assert.deepEqual(getRequestPrincipal(), { kind: 'unknown' });
});

test('request identity context is isolated between concurrent requests', async () => {
  const [first, second] = await Promise.all([
    runWithRequestPrincipal({ kind: 'oauth', clientId: 'client-one' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getRequestPrincipal();
    }),
    runWithRequestPrincipal({ kind: 'oauth', clientId: 'client-two' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getRequestPrincipal();
    }),
  ]);

  assert.deepEqual(first, { kind: 'oauth', clientId: 'client-one' });
  assert.deepEqual(second, { kind: 'oauth', clientId: 'client-two' });
});
