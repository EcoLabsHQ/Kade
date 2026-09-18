import Image from 'next/image';

export interface CountryBadgeProps {
  readonly code: string;
}

/**
 * The reference's country mark: a 16x12 flag image with a 2px radius.
 *
 * The reference loads these from `flagcdn.com` (`w40/<iso>.png`), which is what
 * the deployed MVP does; the handoff README's claim that badges are text-only
 * does not match the prototype's own markup, and the rendered reference clearly
 * shows flags.
 */
export function CountryBadge({ code }: CountryBadgeProps) {
  const iso = code.toLowerCase();

  return (
    <Image
      src={`https://flagcdn.com/w40/${iso}.png`}
      alt=""
      width={16}
      height={12}
      unoptimized
      style={{
        width: '16px',
        height: '12px',
        borderRadius: '2px',
        objectFit: 'cover',
        flex: '0 0 auto',
      }}
    />
  );
}
