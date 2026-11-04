import type { Command } from '../api/commands';
import type { Block } from './block';
import type { Ctx } from './model';

/**
 * The commands that turn the plan into the final blocks, in an order that never leaves a patch
 * in the way of another: first the removals (excluded or replaced patches, and existing patches
 * the search dropped or reshaped), then the moves of existing patches that only slid along their
 * bed, then an `addPatch` (grid form) for each new block and each reshaped one.
 */
export function emitCommands(ctx: Ctx, blocks: Block[]): Command[] {
  const removes: Command[] = [];
  const moves: Command[] = [];
  const adds: Command[] = [];
  const originals = new Map(ctx.editable.flatMap((b) => (b.source === 'new' ? [] : [[b.source.groupId, b] as const])));
  for (const groupId of ctx.removed) removes.push({ type: 'removePatch', groupId });

  const kept = new Set<string>();
  const add = (b: Block) => adds.push({ type: 'addPatch', bedId: b.bedId, cropId: b.cropId, grid: { origin: { x: b.origin.x, y: b.origin.y }, axis: b.axis, columns: b.columns, rows: b.rows } });
  for (const b of blocks) {
    const o = b.source === 'new' ? undefined : originals.get(b.source.groupId);
    if (!o || b.source === 'new') {
      add(b);
      continue;
    }
    kept.add(b.source.groupId);
    if (b.bedId === o.bedId && b.columns === o.columns && b.rows === o.rows) {
      const dx = b.origin.x - o.origin.x;
      const dy = b.origin.y - o.origin.y;
      if (dx !== 0 || dy !== 0) moves.push({ type: 'movePatch', groupId: b.source.groupId, dx, dy });
    } else {
      removes.push({ type: 'removePatch', groupId: b.source.groupId });
      add(b);
    }
  }
  // Existing patches the search dropped.
  for (const groupId of originals.keys()) if (!kept.has(groupId)) removes.push({ type: 'removePatch', groupId });
  return [...removes, ...moves, ...adds];
}
