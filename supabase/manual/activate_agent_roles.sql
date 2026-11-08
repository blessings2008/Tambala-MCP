-- Activates the CEO and the 18 department/business-unit leads that have execution agents.
-- Review first: execution only works for ACTIVE roles. Run in the Supabase SQL editor.
update public.organization_roles set activation='active', updated_at=now() where id in ('ceo','director-sales-business-development','director-research-intelligence','director-customer-relations','director-marketing-brand','director-media-content','director-finance-accounting','leader-fintech-ventures','director-technology-engineering','director-strategy-planning','director-product-innovation','director-cybersecurity-it','director-operations-administration','director-people-agent-management','director-legal-risk-compliance','director-procurement-resources','director-executive-management','director-research-development','director-board-governance');

-- Keep the org-chart unit status consistent with the roles this script activates.
-- A unit is marked active only when at least one of its accountable roles is active.
update public.organization_units u
set status='active'
where u.status='planned'
  and exists (
    select 1
    from unnest(u.accountable_role_ids) as accountable(role_id)
    join public.organization_roles r on r.id = accountable.role_id
    where r.activation='active'
  );
-- Roll back the same units and roles if you intentionally deactivate this activation wave.
update public.organization_units
set status='planned'
where id in (
  select unit_id from public.organization_roles
  where id in ('ceo','director-sales-business-development','director-research-intelligence','director-customer-relations','director-marketing-brand','director-media-content','director-finance-accounting','leader-fintech-ventures','director-technology-engineering','director-strategy-planning','director-product-innovation','director-cybersecurity-it','director-operations-administration','director-people-agent-management','director-legal-risk-compliance','director-procurement-resources','director-executive-management','director-research-development','director-board-governance')
);
-- Roll back: update public.organization_roles set activation='planned' where id in ('ceo','director-sales-business-development','director-research-intelligence','director-customer-relations','director-marketing-brand','director-media-content','director-finance-accounting','leader-fintech-ventures','director-technology-engineering','director-strategy-planning','director-product-innovation','director-cybersecurity-it','director-operations-administration','director-people-agent-management','director-legal-risk-compliance','director-procurement-resources','director-executive-management','director-research-development','director-board-governance');
