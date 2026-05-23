// Brand favicon — rendered at build time as 192×192 PNG.
// Next.js auto-emits <link rel="icon" type="image/png" sizes="192x192" href="/icon">.
import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #e8793a 0%, #c45f20 100%)",
        }}
      >
        <svg width="65%" height="65%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          {/* Upward arrow — the literal "raising arrow" */}
          <path
            d="M 50 84 L 50 22 M 30 42 L 50 22 L 70 42"
            stroke="#ffffff"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
