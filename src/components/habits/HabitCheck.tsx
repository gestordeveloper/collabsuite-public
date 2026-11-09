import { Check } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface HabitCheckProps {
  done: boolean;
  color: string;
  /** "circle" = check-in de hoje (22px); "square" = célula da semana (30px, raio 9). */
  shape?: "circle" | "square";
  size?: number;
  disabled?: boolean;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}

/** Marcador de check-in do hábito, preenchido com a cor do hábito quando cumprido. */
export function HabitCheck({ done, color, shape = "circle", size, disabled, label, onClick }: HabitCheckProps) {
  const px = size ?? (shape === "circle" ? 22 : 30);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid shrink-0 place-items-center border-[1.5px] transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        shape === "circle" ? "rounded-full" : "rounded-[9px]",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:scale-105",
        !done && "border-[#4A4A52] hover:border-muted-foreground"
      )}
      style={{
        width: px,
        height: px,
        ...(done ? { backgroundColor: color, borderColor: color } : {}),
      }}
    >
      {done && <Check className="text-white" style={{ width: px * 0.45, height: px * 0.45 }} strokeWidth={3.5} />}
    </button>
  );
}
