import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOrganization } from '../src/organization/seed.js';
import { validateOrganization } from '../src/organization/validate.js';
import { authorizeOrganizationalAction } from '../src/organization/policy.js';
import { getOrganizationSummary } from '../src/organization/service.js';
import { getRequestPrincipal, runWithRequestPrincipal } from '../src/organization/request-context.js';
import { isAllowedOrganizationTaskTransition } from '../src/organization/task-transition-rules.js';
import { HANDOFF_HEARTBEAT_INTERVAL_MS, HANDOFF_LEASE_TIMEOUT_MS, isReadOnlyResearchQueueHandoff } from '../src/organization/workforce/handoffs.js';

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

test('organization summary reports the expected leadership and planned units', async () => {
  const summary = await getOrganizationSummary();
  assert.equal(summary.name, 'Tambala Organization');
  assert.equal(summary.leadership.ceoRoleId, 'ceo');
  assert.equal(summary.validation.valid, true);
  assert.ok(summary.units.some((unit) => unit.id === 'research-intelligence'));
  assert.ok(summary.units.some((unit) => unit.id === 'fintech-ventures'));
});

test('every unit has an accountable lead in the correct reporting chain', () => {
  const unitsById = new Map(initialOrganization.units.map((unit) => [unit.id, unit]));
  const rolesById = new Map(initialOrganization.roles.map((role) => [role.id, role]));
  const isUnitLead = (roleId: string) => roleId.startsWith('director-') || roleId.startsWith('leader-');

  for (const unit of initialOrganization.units) {
    assert.ok(unit.accountableRoleIds.length > 0, `Unit ${unit.id} must have accountable roles.`);

    for (const roleId of unit.accountableRoleIds) {
      const role = rolesById.get(roleId);
      assert.ok(role, `Unit ${unit.id} references a missing accountable role ${roleId}.`);
      assert.equal(role.unitId, unit.id, `Accountable role ${roleId} must belong to ${unit.id}.`);
    }

    const leadIds = unit.accountableRoleIds.filter(isUnitLead);
    assert.equal(leadIds.length, 1, `Unit ${unit.id} must have exactly one designated director or business-unit lead.`);
    const lead = rolesById.get(leadIds[0]);
    assert.ok(lead, `Unit ${unit.id} is missing its designated lead.`);

    const parent = unit.parentId ? unitsById.get(unit.parentId) : undefined;
    const parentLeadId = parent?.accountableRoleIds.find(isUnitLead);
    const expectedManagerId = parentLeadId ?? initialOrganization.ceoRoleId;
    assert.equal(
      lead.reportsToRoleId,
      expectedManagerId,
      `Lead ${lead.id} must report to ${expectedManagerId} for unit ${unit.id}.`,
    );
  }
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

test('CEO can launch a major venture within delegated authority', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'launch_major_venture',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.requiredAuthority, null);
});

test('CEO authority does not need a second approval record', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'launch_major_venture',
    approval: {
      authority: 'ceo',
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
      authority: 'ceo',
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

test('structural validator rejects accountable roles owned by another unit', () => {
  const broken = structuredClone(initialOrganization);
  const sales = broken.units.find((unit) => unit.id === 'sales-business-development');
  assert.ok(sales);
  sales.accountableRoleIds = ['director-finance-accounting'];

  const errors = validateOrganization(broken);
  assert.ok(errors.some((error) =>
    error.includes('Unit sales-business-development lists role director-finance-accounting as accountable'),
  ));
});

test('structural validator rejects duplicate accountable role entries', () => {
  const broken = structuredClone(initialOrganization);
  const sales = broken.units.find((unit) => unit.id === 'sales-business-development');
  assert.ok(sales);
  sales.accountableRoleIds = [
    'director-sales-business-development',
    'director-sales-business-development',
  ];

  const errors = validateOrganization(broken);
  assert.ok(errors.some((error) =>
    error.includes('lists accountable role more than once: director-sales-business-development'),
  ));
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

test('department and business-unit leads cannot execute financial transactions', () => {
  for (const roleId of ['director-finance-accounting', 'leader-fintech-ventures']) {
    const result = authorizeOrganizationalAction({
      actorRole: role(roleId),
      action: 'execute_financial_transaction',
      approval: {
        authority: 'founder',
        approved: true,
        approvalId: 'approval-test-finance-001',
      },
    });
    assert.equal(result.allowed, false, `${roleId} must not gain transaction authority from an approval alone.`);
    assert.equal(result.requiresApproval, false);
  }
});

test('financial transaction authority is delegated to the CEO role', () => {
  const founderResult = authorizeOrganizationalAction({
    actorRole: role('founder'),
    action: 'execute_financial_transaction',
  });
  const ceoResult = authorizeOrganizationalAction({
    actorRole: role('ceo'),
    action: 'execute_financial_transaction',
  });

  assert.equal(founderResult.allowed, false);
  assert.equal(founderResult.requiresApproval, true);
  assert.equal(founderResult.requiredAuthority, 'ceo');
  assert.equal(ceoResult.allowed, true);
  assert.equal(ceoResult.requiresApproval, false);
});



test('all restricted actions are directly delegated to the CEO', () => {
  const restrictedActions = [
    'launch_major_venture',
    'commit_material_funds',
    'change_mission',
    'close_major_business_unit',
    'send_sensitive_external_communication',
    'execute_financial_transaction',
  ] as const;

  for (const action of restrictedActions) {
    const delegated = authorizeOrganizationalAction({ actorRole: role('ceo'), action });
    assert.equal(delegated.allowed, true, `CEO should have delegated authority for ${action}.`);
    assert.equal(delegated.requiresApproval, false, `${action} should not need Founder input.`);
  }
});

test('Founder retains direct override without creating approval requests', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('founder'),
    action: 'commit_material_funds',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, false);
});

test('non-CEO roles cannot use CEO-reserved actions without a valid CEO approval', () => {
  const result = authorizeOrganizationalAction({
    actorRole: role('founder'),
    action: 'commit_material_funds',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.requiredAuthority, 'ceo');
});

test('every department has an accountable lead connected to its reporting structure', () => {
  const departments = initialOrganization.units.filter((unit) => unit.kind === 'department');
  assert.equal(departments.length, 18);

  for (const department of departments) {
    assert.equal(
      department.accountableRoleIds.length,
      1,
      `${department.name} must have one clearly accountable department lead`,
    );

    const leadId = department.accountableRoleIds[0];
    const lead = initialOrganization.roles.find((candidate) => candidate.id === leadId);
    assert.ok(lead, `${department.name} must reference an existing lead role`);
    assert.equal(lead.unitId, department.id, `${department.name} lead must belong to that department`);
    assert.equal(lead.kind, 'ai_agent', `${department.name} lead must have an explicit agent role definition`);

    const parent = initialOrganization.units.find((unit) => unit.id === department.parentId);
    const expectedManager = parent
      ? parent.accountableRoleIds.find((roleId) => roleId.startsWith('director-'))
      : initialOrganization.ceoRoleId;
    assert.ok(expectedManager, `${department.name} must have a defined reporting manager`);
    assert.equal(
      lead.reportsToRoleId,
      expectedManager,
      `${department.name} lead must report to its division director or the CEO`,
    );
  }
});



test('a retried department task may return to CEO analysis', () => {
  assert.equal(isAllowedOrganizationTaskTransition('executing', 'ceo_analyzing'), true);
});


test('stale handoffs recover promptly after a worker restart', () => {
  assert.equal(HANDOFF_HEARTBEAT_INTERVAL_MS, 30_000);
  assert.equal(HANDOFF_LEASE_TIMEOUT_MS, 5 * 60_000);
  assert.ok(HANDOFF_LEASE_TIMEOUT_MS > HANDOFF_HEARTBEAT_INTERVAL_MS * 5);
});


test('only read-only discovery queue Research handoffs auto-retry after lease expiry', () => {
  const safe = {
    to_agent: 'research',
    source_duty_id: 'lead-discovery-queue-research-review',
    context_summary: '{"source":"public.lead_discovery_queue"}',
    request: 'Re-assess this existing queue record. Do not contact the organisation.',
  } as const;
  assert.equal(isReadOnlyResearchQueueHandoff(safe), true);
  assert.equal(isReadOnlyResearchQueueHandoff({ ...safe, to_agent: 'outreach' }), false);
  assert.equal(isReadOnlyResearchQueueHandoff({ ...safe, request: 'Send a WhatsApp message to the prospect.' }), false);
});
