export function Logo({ size = 84 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden className="login-logo">
      <defs>
        <linearGradient id="lg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E3C88F" />
          <stop offset="1" stopColor="#A9843F" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="#1B1916" />
      <circle cx="60" cy="60" r="50" fill="none" stroke="url(#lg-gold)" strokeWidth="2" />
      <text x="60" y="73" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="40" fontWeight="700" fill="url(#lg-gold)" letterSpacing="1">LC</text>
      <circle cx="44" cy="90" r="3.2" fill="#F6DCE3" />
      <circle cx="54" cy="92" r="3.2" fill="#F9E3CF" />
      <circle cx="66" cy="92" r="3.2" fill="#DDEFE2" />
      <circle cx="76" cy="90" r="3.2" fill="#E6E0F4" />
    </svg>
  );
}
