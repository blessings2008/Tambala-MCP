import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOrganization } from '../src/organization/seed.ts';
import { routeObjective, DEPARTMENT_CAPABILITIES } from '../src/organization/capability-registry.ts';
import { decideForRole, SENSITIVE_TOOLS, STANDARD_WRITE_TOOLS, authorizeToolCall } from '../src/organization/write-guard.ts';
import { advanceTrackedTask, beginTrackedTask } from '../src/organization/task-tracking.ts';
import { registerAllTools } from '../src/tools/registry.ts';

const role = (id: string) => initialOrganization.roles.find((r) => r.id === id)!;
const active = (id: string) => ({ ...role(id), activation: 'active' as const });

test('every capability resolves to its own unit and a role in that unit', () => {
  for (const cap of DEPARTMENT_CAPABILITIES) {
    const m = routeObjective(initialOrganization, cap.objectiveKeywords[0]).find((x) => x.capability.id === cap.id)!;
    assert.equal(m.unit?.id, cap.unitId, `${cap.id} unit`);
    assert.equal(m.role?.unitId, cap.unitId, `${cap.id} role unit`);
  }
});

test('HR routes to People & Agent Management, not AI & Automation', () => {
  const m = routeObjective(initialOrganization, 'Define the agent lifecycle and onboarding plan').find((x) => x.capability.id === 'people_agent_management')!;
  assert.equal(m.unit?.id, 'people-agent-management');
});

test('hotel/lodge website prospecting routes to Sales', () => {
  const r = routeObjective(initialOrganization, 'Find hotels and lodges in Malawi that could use a website');
  assert.equal(r[0]?.capability.id, 'sales_prospecting');
});

test('shared tag collisions cannot reroute a capability even if stored data differs', () => {
  const org = structuredClone(initialOrganization);
  org.units.find((u) => u.id === 'people-agent-management')!.tags = ['people', 'agents', 'roles'];
  const m = routeObjective(org, 'agent lifecycle').find((x) => x.capability.id === 'people_agent_management')!;
  assert.equal(m.unit?.id, 'people-agent-management');
});

test('write guard: founder may do everything; CEO and directors cannot use Founder-only tools', () => {
  for (const tool of [...SENSITIVE_TOOLS, ...STANDARD_WRITE_TOOLS]) assert.equal(decideForRole(active('founder'), tool).allowed, true);
  for (const tool of SENSITIVE_TOOLS) {
    assert.equal(decideForRole(active('ceo'), tool).allowed, false, tool);
    assert.equal(decideForRole(active('director-sales-business-development'), tool).allowed, false, tool);
  }
  assert.equal(decideForRole(active('director-sales-business-development'), 'update_lead').allowed, true);
});

test('write guard: planned roles, unbound callers and capability-less roles are denied', () => {
  assert.equal(decideForRole(role('director-sales-business-development'), 'update_lead').allowed, false);
  assert.equal(decideForRole(null, 'update_lead').allowed, false);
  assert.equal(decideForRole(active('executive-council'), 'update_lead').allowed, false);
});

test('write guard is a no-op unless enforcement is enabled', async () => {
  delete process.env.TAMBALA_ENFORCE_ROLE_BINDINGS;
  assert.equal((await authorizeToolCall('create_client')).allowed, true);
});

test('task tracking degrades gracefully without a database', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const begun = await beginTrackedTask('test objective');
  assert.equal(begun.tracking, 'unavailable');
  assert.ok(begun.taskId);
  assert.equal(await advanceTrackedTask(begun.taskId, [{ status: 'ceo_analyzing', stage: 'ceo', eventType: 'x' }]), 'unavailable');
});

test('registry registers every tool, guarded tools included, with no duplicate names', () => {
  const names: string[] = [];
  const fake = { registerTool: (name: string) => { names.push(name); } } as never;
  registerAllTools(fake);
  assert.equal(new Set(names).size, names.length);
  for (const t of [...SENSITIVE_TOOLS, ...STANDARD_WRITE_TOOLS]) assert.ok(names.includes(t), `${t} missing`);
});
