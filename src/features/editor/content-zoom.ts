export const CONTENT_ZOOM_STEPS = Object.freeze(
  Array.from({ length: 11 }, (_, index) => index * 10),
);

export function normalizeContentZoom(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isInteger(parsed) || !CONTENT_ZOOM_STEPS.includes(parsed)) return 0;
  return parsed;
}

export function nextContentZoom(value: string | number | null | undefined, delta: number): number {
  const current = normalizeContentZoom(value);
  const index = CONTENT_ZOOM_STEPS.indexOf(current);
  const nextIndex = Math.max(0, Math.min(CONTENT_ZOOM_STEPS.length - 1, index + Math.sign(delta)));
  return CONTENT_ZOOM_STEPS[nextIndex];
}

export function contentZoomScale(value: string | number | null | undefined): number {
  return 1 + normalizeContentZoom(value) / 100;
}

export function scaledMediaWidth(naturalWidth: number, availableWidth: number, scale: number): number {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(availableWidth) || !Number.isFinite(scale)) return 0;
  if (naturalWidth <= 0 || availableWidth <= 0 || scale <= 0) return 0;
  return Math.min(naturalWidth * scale, availableWidth);
}
