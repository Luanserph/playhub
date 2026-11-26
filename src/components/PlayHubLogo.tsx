interface PlayHubLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export function PlayHubLogo({
  size = 32,
  showWordmark = true,
  className = '',
}: PlayHubLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="ph-silver" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#A1A1AA" />
          </linearGradient>
        </defs>
        {/* Base escura editorial */}
        <rect width="64" height="64" rx="16" fill="#09090B" />
        <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />

        {/* Abertura de lente quadrada arredondada segmentada */}
        <path
          d="M16 25V20C16 17.7909 17.7909 16 20 16H27"
          stroke="url(#ph-silver)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M37 16H44C46.2091 16 48 17.7909 48 20V25"
          stroke="url(#ph-silver)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M48 39V44C48 46.2091 46.2091 48 44 48H37"
          stroke="url(#ph-silver)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M27 48H20C17.7909 48 16 46.2091 16 44V39"
          stroke="url(#ph-silver)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />

        {/* Triângulo Play central */}
        <path
          d="M28.2 24.4C27.1 23.75 25.7 24.55 25.7 25.82V38.18C25.7 39.45 27.1 40.25 28.2 39.6L38.9 33.42C40 32.78 40 31.22 38.9 30.58L28.2 24.4Z"
          fill="url(#ph-silver)"
        />
      </svg>

      {showWordmark && (
        <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-[var(--ph-text)]">
          PlayHub
        </span>
      )}
    </span>
  );
}
