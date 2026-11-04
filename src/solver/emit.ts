import type { Command } from '../api/commands';
import type { Block } from './block';

/** The commands that turn the plan into the final blocks: an `addPatch` (grid form) for each new block. */
export function emitCommands(blocks: Block[]): Command[] {
  const commands: Command[] = [];
  for (const b of blocks) {
    if (b.source !== 'new') continue;
    commands.push({ type: 'addPatch', bedId: b.bedId, cropId: b.cropId, grid: { origin: { x: b.origin.x, y: b.origin.y }, axis: b.axis, columns: b.columns, rows: b.rows } });
  }
  return commands;
}
