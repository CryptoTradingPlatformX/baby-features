import type { Angle } from "../types";

export function GuideOverlay({ angle }: { angle: Angle }) {
  const maskId = `guide-${angle}`;
  return (
    <svg className="guide" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <rect width="300" height="400" fill="white" />
          {angle === "front" ? <FrontCutout /> : <ProfileCutout flip={angle === "right"} />}
        </mask>
      </defs>
      <rect width="300" height="400" fill="rgba(42, 24, 16, 0.42)" mask={`url(#${maskId})`} />
      {angle === "front" ? <FrontStroke /> : <ProfileStroke flip={angle === "right"} />}
    </svg>
  );
}

function FrontCutout() {
  return (
    <g fill="black">
      <ellipse cx="62" cy="198" rx="22" ry="34" />
      <ellipse cx="238" cy="198" rx="22" ry="34" />
      <ellipse cx="150" cy="196" rx="92" ry="122" />
    </g>
  );
}

function FrontStroke() {
  return (
    <g fill="none" stroke="#fffaf6" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 8">
      <ellipse cx="62" cy="198" rx="22" ry="34" />
      <ellipse cx="238" cy="198" rx="22" ry="34" />
      <ellipse cx="150" cy="196" rx="92" ry="122" />
      <ellipse cx="118" cy="176" rx="16" ry="9" strokeDasharray="0" opacity="0.9" />
      <ellipse cx="182" cy="176" rx="16" ry="9" strokeDasharray="0" opacity="0.9" />
      <path d="M150 188 v28" strokeDasharray="0" opacity="0.8" />
      <path d="M128 246 q22 16 44 0" strokeDasharray="0" opacity="0.9" />
    </g>
  );
}

function ProfileCutout({ flip }: { flip: boolean }) {
  return (
    <g fill="black" transform={flip ? "translate(300 0) scale(-1 1)" : undefined}>
      <path d={PROFILE_PATH} />
    </g>
  );
}

function ProfileStroke({ flip }: { flip: boolean }) {
  return (
    <g
      fill="none"
      stroke="#fffaf6"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="7 8"
      transform={flip ? "translate(300 0) scale(-1 1)" : undefined}
    >
      <path d={PROFILE_PATH} />
    </g>
  );
}

const PROFILE_PATH =
  "M168 58 C214 54 236 92 232 132 C248 140 268 158 258 186 C250 206 232 204 220 190 C222 214 214 236 198 252 C214 286 188 332 156 346 C132 356 118 334 122 308 C92 300 70 268 84 226 C58 214 52 168 82 146 C70 112 104 62 168 58 Z";
