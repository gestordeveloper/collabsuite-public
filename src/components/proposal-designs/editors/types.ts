import type { SlideHeader } from "@/src/lib/proposal-designs/types";

export interface KindEditorProps<D> {
  header: SlideHeader | undefined;
  onHeaderChange: (h: SlideHeader) => void;
  data: D;
  onChange: (d: D) => void;
}
