interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, photoUrl, size = 36 }: AvatarProps) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="rounded-full object-cover border-2 border-white shadow-soft"
        style={{ width: size, height: size }}
      />
    );
  }
  const bg = "#E6332A";
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold shadow-soft"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.4 }}
    >
      {initials(name)}
    </div>
  );
}
