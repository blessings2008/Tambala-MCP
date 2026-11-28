/**
 * Distinguish expected business/workflow validation blocks from incidents
 * that require Cybersecurity & IT investigation.
 *
 * These blocks remain visible on their originating task and must be corrected
 * by the owning department; they are not security incidents.
 */
const NON_SECURITY_WORKFLOW_BLOCKS: RegExp[] = [
  /DISCOVERED_PROSPECTS JSON block/i,
  /(?:autonomous )?first-contact outreach requires a matching CRM lead with a verified WhatsApp number/i,
  /no matching CRM lead with a verified WhatsApp number/i,
  /could not verify this CRM number as a WhatsApp-registered lead/i,
  /not registered on WhatsApp/i,
  /exists["']?\s*:\s*false/i,
  /not a valid phone number/i,
  /AI request blocked by Tambala(?:'s|’s) free-only policy/i,
  /model.{0,80}not verified as free/i,
  /missing its CRM destination or verified organisation name/i,
  /no customer message was queued/i,
  /DECISION:\\s*(?:REVISION_REQUIRED|FOUNDER_INPUT_REQUIRED)/i,
  /employee omitted the required SELF_REVIEW/i,
  /maximum of \\d+ attempts reached/i,
  /handoff worker lease expired|worker stopped reporting heartbeats/i,
  /same message was already prepared or sent to this number/i,
];

export function isNonSecurityWorkflowBlock(message: string): boolean {
  const value = message.trim();
  return value.length > 0 && NON_SECURITY_WORKFLOW_BLOCKS.some((pattern) => pattern.test(value));
}
