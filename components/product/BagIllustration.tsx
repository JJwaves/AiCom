/**
 * Hand-built SVG bag illustration — the designed PLACEHOLDER that stands in until the
 * owner's product photography exists (never a stock photo, never AI imagery).
 * Renders in the configured bag colour with an optional logo placeholder on the print
 * face. Line work uses the brand tokens (CSS variables resolve inside inline SVG).
 */

export function BagIllustration({
  bodyColor = "var(--color-brand-surface)",
  showLogo = false,
  logoColors = 1,
  className,
  title = "Illustration of an insulated takeout bag",
}: {
  bodyColor?: string;
  showLogo?: boolean;
  logoColors?: number;
  className?: string;
  title?: string;
}) {
  const isGradient = bodyColor.includes("gradient");
  const fill = isGradient ? "var(--color-brand-surface)" : bodyColor;
  // Dark bag bodies need light line work
  const dark = /oklch\((?:1[0-9]|2[0-9]|3[0-9]|4[0-5])%/.test(bodyColor);
  const line = dark ? "var(--color-brand-canvas-on-ink-muted)" : "var(--color-brand-ink-2)";
  const crease = dark ? "var(--color-brand-ink-muted)" : "var(--color-brand-hairline-strong)";

  return (
    <svg
      viewBox="0 0 320 340"
      role="img"
      aria-label={title}
      className={className}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <title>{title}</title>
      {/* Ground shadow */}
      <ellipse cx="160" cy="316" rx="110" ry="10" fill="var(--color-brand-ink)" opacity="0.08" />
      {/* Gusset (side panel) */}
      <path
        d="M232 112 L268 130 L268 300 L232 312 Z"
        fill={fill}
        stroke={line}
        strokeWidth="2.5"
        strokeLinejoin="round"
        style={{ filter: "brightness(0.93)" }}
      />
      {/* Bag front */}
      <path
        d="M52 112 L232 112 L232 312 L52 312 Z"
        fill={fill}
        stroke={line}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Top fold line */}
      <line x1="52" y1="132" x2="232" y2="132" stroke={crease} strokeWidth="1.5" />
      {/* Gusset crease */}
      <line x1="250" y1="124" x2="250" y2="304" stroke={crease} strokeWidth="1.5" />
      {/* Loop handles */}
      <path
        d="M96 112 C96 52, 148 52, 148 112"
        fill="none"
        stroke={line}
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M186 112 C186 62, 238 70, 246 122"
        fill="none"
        stroke={line}
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* Stitch marks on handle base */}
      <path d="M92 112 h10 M143 112 h10" stroke={line} strokeWidth="3" strokeLinecap="round" />
      {/* Print face: logo placeholder */}
      {showLogo && (
        <g>
          <rect
            x="92"
            y="176"
            width="100"
            height="64"
            rx="6"
            fill="none"
            stroke={line}
            strokeWidth="2"
            strokeDasharray="6 5"
          />
          <circle cx="118" cy="200" r="12" fill={line} opacity="0.85" />
          {logoColors >= 2 && <rect x="138" y="192" width="42" height="7" rx="3.5" fill="var(--color-brand-accent)" />}
          {logoColors < 2 && <rect x="138" y="192" width="42" height="7" rx="3.5" fill={line} opacity="0.7" />}
          <rect x="138" y="206" width="30" height="6" rx="3" fill={line} opacity="0.5" />
          <text
            x="142"
            y="232"
            fontSize="10"
            fontFamily="var(--font-body)"
            fill={line}
            opacity="0.7"
            textAnchor="middle"
          >
            YOUR LOGO
          </text>
        </g>
      )}
      {/* Non-woven texture hint */}
      <g stroke={crease} strokeWidth="1" opacity="0.5">
        <line x1="68" y1="292" x2="88" y2="292" />
        <line x1="196" y1="152" x2="216" y2="152" />
        <line x1="62" y1="160" x2="78" y2="160" />
      </g>
    </svg>
  );
}
