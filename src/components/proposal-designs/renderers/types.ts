import type { RunningHeader, SlideHeader, ThemeTokens } from "@/src/lib/proposal-designs/types";

export interface KindRendererProps<D> {
  data: D;
  header?: SlideHeader;
  tone: "dark" | "light";
  runningHeader?: RunningHeader;
  theme: ThemeTokens;
}
