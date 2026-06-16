import type { PatternStyle, ProductColor } from "@/lib/types";

/**
 * Small programmatic fabric swatch (SVG) for catalog cards and quote lines, where a
 * product photo isn't carried. The full in-room scene renders that used to live here were
 * retired once the catalog moved to real product photos — only the swatch remains.
 */

// Deterministic ids keep server and client markup identical; duplicate defs
// with the same id render identically, so collisions are harmless.
const patternId = (style: PatternStyle, color: ProductColor) =>
  `pat-${style}-${color.id}-${color.hex.slice(1)}`;

function PatternDefs({
  id,
  style,
  color,
}: {
  id: string;
  style: PatternStyle;
  color: ProductColor;
}) {
  const accent = color.accentHex ?? shade(color.hex, -14);
  switch (style) {
    case "linen":
      return (
        <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill={color.hex} />
          <path d="M0 3.5h7" stroke={accent} strokeWidth="0.8" opacity="0.5" />
          <path d="M3.5 0v7" stroke={accent} strokeWidth="0.5" opacity="0.35" />
        </pattern>
      );
    case "stripe":
      return (
        <pattern id={id} width="34" height="10" patternUnits="userSpaceOnUse">
          <rect width="34" height="10" fill={color.hex} />
          <rect x="20" width="9" height="10" fill={accent} opacity="0.85" />
        </pattern>
      );
    case "screen":
      return (
        <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={color.hex} opacity="0.9" />
          <circle cx="2" cy="2" r="0.7" fill="#ffffff" opacity="0.55" />
        </pattern>
      );
    case "botanical":
      return (
        <pattern id={id} width="46" height="52" patternUnits="userSpaceOnUse">
          <rect width="46" height="52" fill={color.hex} />
          <g fill="none" stroke={accent} strokeWidth="1.4" opacity="0.8">
            <path d="M12 44 C10 32 16 24 14 12" />
            <path d="M14 30 C8 28 5 22 6 16" />
            <path d="M14 30 C20 28 23 22 22 16" />
            <path d="M36 50 C38 40 33 34 35 24" />
            <path d="M35 36 C30 34 28 29 29 24" />
          </g>
        </pattern>
      );
    case "geo":
      return (
        <pattern id={id} width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill={color.hex} />
          <path
            d="M13 2 L24 13 L13 24 L2 13 Z"
            fill="none"
            stroke={accent}
            strokeWidth="1.3"
            opacity="0.7"
          />
          <circle cx="13" cy="13" r="1.4" fill={accent} opacity="0.6" />
        </pattern>
      );
    case "velvet":
      return (
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={shade(color.hex, 14)} />
          <stop offset="0.45" stopColor={color.hex} />
          <stop offset="0.65" stopColor={shade(color.hex, -12)} />
          <stop offset="1" stopColor={shade(color.hex, 6)} />
        </linearGradient>
      );
    case "voile":
      return (
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={color.hex} opacity="0.7" />
        </pattern>
      );
    case "weave":
      return (
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={color.hex} />
          <path d="M0 2h8M0 6h8" stroke={shade(color.hex, -12)} strokeWidth="1.1" opacity="0.55" />
          <path d="M2 0v8M6 0v8" stroke={color.accentHex ?? shade(color.hex, -8)} strokeWidth="1.1" opacity="0.4" />
        </pattern>
      );
    case "solid":
    default:
      return (
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(color.hex, 5)} />
          <stop offset="1" stopColor={shade(color.hex, -5)} />
        </linearGradient>
      );
  }
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Small fabric swatch used on catalog cards and quote lines. */
export function Swatch({
  color,
  patternStyle,
  size = 56,
  rounded = 12,
}: {
  color: ProductColor;
  patternStyle: PatternStyle;
  size?: number;
  rounded?: number;
}) {
  const patId = patternId(patternStyle, color);
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" className="shrink-0">
      <defs>
        <PatternDefs id={patId} style={patternStyle} color={color} />
      </defs>
      <rect width="56" height="56" rx={rounded} fill={`url(#${patId})`} />
      <rect width="56" height="56" rx={rounded} fill="none" stroke="#00000018" strokeWidth="1" />
    </svg>
  );
}
