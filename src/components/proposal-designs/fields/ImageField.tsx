import { ImageUpload } from "@/src/components/common/ImageUpload";
import type { ImageRef } from "@/src/lib/proposal-designs/types";

interface Props {
  label: string;
  value: ImageRef | undefined;
  onChange: (v: ImageRef) => void;
  previewClass?: string;
}

export function ImageField({ label, value, onChange, previewClass = "h-20 w-full" }: Props) {
  return (
    <ImageUpload
      label={label}
      value={value?.url || ""}
      onChange={(url) => onChange({ url, alt: value?.alt })}
      previewClass={previewClass}
    />
  );
}
