/**
 * Employees may end their work with machine-readable blocks, each introduced by a heading on its own line:
 *   HANDOFFS:   asks for a colleague's help
 *   ACTIONS:    requests real-world actions (messages, documents, invoices)
 * Blocks are cut out of the visible work and parsed separately.
 */
export type BlockName = 'HANDOFFS' | 'ACTIONS';
const NAMES: BlockName[] = ['HANDOFFS', 'ACTIONS'];

export function splitBlocks(body: string): { clean: string; blocks: Partial<Record<BlockName, string>> } {
  const lines = body.split('\n');
  const blocks: Partial<Record<BlockName, string[]>> = {};
  const kept: string[] = [];
  let current: BlockName | null = null;
  for (const line of lines) {
    const heading = NAMES.find((n) => new RegExp(`^\\s*\\**${n}:?\\**\\s*$`, 'i').test(line));
    if (heading) { current = heading; blocks[heading] = blocks[heading] ?? []; continue; }
    if (current) (blocks[current] as string[]).push(line); else kept.push(line);
  }
  return {
    clean: kept.join('\n').trimEnd(),
    blocks: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, (v as string[]).join('\n')])) as Partial<Record<BlockName, string>>,
  };
}
