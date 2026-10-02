import { Link } from "@tanstack/react-router";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
      <rect x="3" y="7" width="26" height="26" rx="5" fill="none" stroke="url(#lg)" strokeWidth="2.5" />
      <rect x="8" y="22" width="4" height="4" fill="url(#lg)" opacity=".5" />
      <rect x="13" y="17" width="4" height="4" fill="url(#lg)" opacity=".75" />
      <rect x="18" y="12" width="4" height="4" fill="url(#lg)" />
      <path d="M31 3 L33 9 L39 11 L33 13 L31 19 L29 13 L23 11 L29 9 Z" fill="var(--cyan)" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-lg font-bold tracking-wider">
        PIXEL <span className="text-gradient">RESURRECT</span>
      </span>
    </Link>
  );
}
