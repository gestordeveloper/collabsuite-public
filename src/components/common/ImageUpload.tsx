import { useRef, useState } from "react";
import { Upload, X, ImageIcon } from "lucide-react";
import * as uploadService from "@/src/services/upload.service";

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  previewClass?: string;
}

export function ImageUpload({ value, onChange, label, previewClass = "h-20 w-20" }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadService.uploadImage(file);
      onChange(url);
    } catch (err) {
      console.error("Upload failed", err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      {label && <label className="text-xs font-semibold block">{label}</label>}
      <div className="flex items-center gap-3">
        {value ? (
          <div className="relative group">
            <img src={value} alt="" className={`rounded-lg border object-cover ${previewClass}`} />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white shadow hover:bg-destructive/90"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className={`flex items-center justify-center rounded-lg border border-dashed bg-muted/30 ${previewClass}`}>
            <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
          </div>
        )}
        <label className="cursor-pointer">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
          <span className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors cursor-pointer">
            {uploading ? (
              <span className="animate-pulse">Enviando...</span>
            ) : (
              <><Upload className="h-3.5 w-3.5" /> {value ? "Trocar" : "Upload"}</>
            )}
          </span>
        </label>
      </div>
    </div>
  );
}
