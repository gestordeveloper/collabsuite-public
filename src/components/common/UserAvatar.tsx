import { cn } from "@/src/lib/utils";
import { accentFromString } from "@/src/lib/design";

interface UserAvatarProps {
  user?: { first_name?: string | null; last_name?: string | null; photo?: string | null } | null;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_PHOTOS = [
  "https://images.unsplash.com/photo-1633332755192-727a05c4013d",
];

export function UserAvatar({ user, className, style }: UserAvatarProps) {
  const photo =
    user?.photo && !DEFAULT_PHOTOS.includes(user.photo) ? user.photo : null;
  const name = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim();
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");

  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className={cn("h-10 w-10 rounded-full object-cover", className)}
        style={style}
      />
    );
  }

  // Design system: círculo com cor sólida da paleta e iniciais em preto (#0B0B0D).
  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-[#0B0B0D]",
        className
      )}
      style={{ backgroundColor: accentFromString(name || "U U"), ...style }}
    >
      {initials || "?"}
    </div>
  );
}
