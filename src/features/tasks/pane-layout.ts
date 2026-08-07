export interface PanePair {
  first: number;
  second: number;
}

export function resizePanePair(first: number, second: number, delta: number, minimum: number, minimumSecond: number = minimum): PanePair {
  const total = Math.max(0, first) + Math.max(0, second);
  if (total < minimum + minimumSecond) return { first: total / 2, second: total / 2 };
  const nextFirst = Math.min(total - minimumSecond, Math.max(minimum, first + delta));
  return { first: nextFirst, second: total - nextFirst };
}

export function clampDivider(pointer: number, left: number, right: number, minimum: number, resizerWidth = 0): number {
  const lower = left + minimum;
  const upper = right - minimum - resizerWidth;
  return Math.min(Math.max(pointer, lower), Math.max(lower, upper));
}
