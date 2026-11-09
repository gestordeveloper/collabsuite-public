import { useRef, useEffect } from "react";

const EMOJIS = [
  "💼", "📋", "📝", "✅", "📌", "🎯", "🚀", "⭐", "💡", "🔧",
  "📊", "📈", "📉", "🗂️", "📁", "📎", "🔗", "📅", "⏰", "⚡",
  "🔥", "💪", "🎨", "🎵", "📚", "✏️", "💻", "🖥️", "📱", "🌐",
  "🎉", "🏆", "🥇", "🌟", "💎", "🔑", "🛠️", "⚙️", "📡", "🎬",
  "❤️", "💙", "💚", "💛", "🧡", "💜", "🖤", "🤍", "💝", "✨",
  "👋", "🤝", "👍", "👏", "💬", "🗣️", "📢", "🔔", "👀", "🧠",
  "🚩", "🏁", "🔵", "🔴", "🟢", "🟡", "🟠", "🟣", "⚪",
  "☀️", "🌙", "🌈", "☁️", "🌊", "🌍", "🌱", "🌸",
  "🍕", "☕", "🧃", "🍀", "🎲", "🧩", "🎭", "🎪", "🎤", "🎧",
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 w-72 rounded-xl border bg-popover p-3 text-popover-foreground shadow-2xl"
      style={{ top: "100%", left: 0, marginTop: 8 }}
    >
      <div className="grid grid-cols-10 gap-1">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-base transition-colors hover:bg-accent"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}