export interface InitialsBadgeProps {
  readonly name: string;
  readonly index: number;
}

function initials(name: string, index: number): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return String(index + 1);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${second}`.toUpperCase();
}

/** The reference's household avatar: a 30px blue tint circle with initials. */
export function InitialsBadge({ name, index }: InitialsBadgeProps) {
  return (
    <span
      aria-hidden
      style={{
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        background: '#EAF2FC',
        color: '#0063B5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 700,
        flex: '0 0 auto',
      }}
    >
      {initials(name, index)}
    </span>
  );
}
