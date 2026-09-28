import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 18, ...props }: IconProps): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);

export const PauseIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="7" y="5.5" width="3.6" height="13" rx="1" />
    <rect x="13.4" y="5.5" width="3.6" height="13" rx="1" />
  </svg>
);

export const PrevIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6" y="5.5" width="2.4" height="13" rx="1" />
    <path d="M19 5.5v13l-10-6.5z" />
  </svg>
);

export const NextIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M5 5.5v13l10-6.5z" />
    <rect x="15.6" y="5.5" width="2.4" height="13" rx="1" />
  </svg>
);

export const VolumeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    <path d="M16 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export const MuteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    <path d="m16.5 9.5 4 5m0-5-4 5" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

export const HeartIcon = ({ filled = false, ...props }: IconProps & { filled?: boolean }) => (
  <svg {...base(props)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6c0 5-7 9.4-7 9.4z" />
  </svg>
);

export const ShareIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="18" cy="6" r="2.4" />
    <circle cx="6" cy="12" r="2.4" />
    <circle cx="18" cy="18" r="2.4" />
    <path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
  </svg>
);

export const ExternalIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 5h5v5" />
    <path d="m19 5-8 8" />
    <path d="M18.5 14v4.5A1.5 1.5 0 0 1 17 20H6.5A1.5 1.5 0 0 1 5 18.5V8a1.5 1.5 0 0 1 1.5-1.5H11" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 6.5 9.5 17 4 11.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const ShuffleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h3.5l9 10H20M4 17h3.5l9-10H20" />
    <path d="m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5" />
    <path d="M12 7.8h.01" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

export const RadioIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="9" width="18" height="11" rx="2.5" />
    <path d="M7 9 17 4" />
    <circle cx="8.5" cy="14.5" r="2.4" />
    <path d="M13.5 12.5H18M13.5 16.5H18" />
  </svg>
);

export const LoadingIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.9 2.9M14.8 14.8l2.9 2.9M17.7 6.3l-2.9 2.9M9.2 14.8l-2.9 2.9" />
  </svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 14 6-6 6 6" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 10 6 6 6-6" />
  </svg>
);
