import { MAX_CUSTOM_LENGTH_IN } from '../data/crops';
import { formatLength, parseLength } from './layoutInteraction';

/** What the "Add your own plant" form holds: the name, and two lengths as the gardener typed them. */
export interface CustomPlantInput {
  name: string;
  spacing: string;
  height: string;
}

export const MAX_SPACING_IN = 120;

export type CustomPlantResult = { ok: true; name: string; spacingIn: number; heightIn?: number } | { ok: false; error: string };

/** Checks the form: a name, a spacing of 1″ to 10′, and (optionally) a height up to the data layer's limit. A bare number is inches. */
export function readCustomPlant(input: CustomPlantInput): CustomPlantResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give your plant a name.' };
  const spacing = parseLength(input.spacing, { bareUnit: 'in' });
  if (spacing === null || spacing < 1 || spacing > MAX_SPACING_IN) return { ok: false, error: 'Spacing should be between 1″ and 10′.' };
  if (input.height.trim() === '') return { ok: true, name, spacingIn: Math.round(spacing) };
  const height = parseLength(input.height, { bareUnit: 'in' });
  if (height === null || height > MAX_CUSTOM_LENGTH_IN) return { ok: false, error: 'Height should be a length like 18″ or 3′.' };
  return { ok: true, name, spacingIn: Math.round(spacing), heightIn: Math.round(height) };
}

/** The line under a length field: what was understood (“= 1′ 6″ apart”), a nudge, or the placeholder. */
export function lengthHint(text: string, noun: string, empty: string, example: string): string {
  if (!text.trim()) return empty;
  const v = parseLength(text, { bareUnit: 'in' });
  return v === null ? `Try ${example}` : `= ${formatLength(v)} ${noun}`;
}
