import type { DesignSlideOverride, SlideEnvelope, ThemeTokens } from "./types";

/**
 * Merges per-task overrides on top of a design's base slides.
 * Shallow, one-level-deep merge — an overridden array field (cards[], etc.)
 * replaces the whole array, matching how `values.items[]` overrides already
 * behave in the classic proposal system.
 */
export function mergeDesignSlides(
  base: SlideEnvelope[],
  overrides: Record<string, DesignSlideOverride> | null | undefined
): SlideEnvelope[] {
  if (!overrides) return base;
  return base.map((slide) => {
    const o = overrides[slide.id];
    if (!o) return slide;
    return {
      ...slide,
      enabled: o.enabled !== undefined ? o.enabled : slide.enabled,
      header: o.header ? { ...slide.header, ...o.header } : slide.header,
      data: o.data ? { ...slide.data, ...o.data } : slide.data,
    };
  });
}

export function mergeTheme(
  base: ThemeTokens,
  overrides: Partial<ThemeTokens> | null | undefined
): ThemeTokens {
  return overrides ? { ...base, ...overrides } : base;
}

export function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
