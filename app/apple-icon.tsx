// iOS apple-touch-icon — 180×180 PNG rendered at build time.
// Apple expects no transparency + rounded mask applied by iOS itself.
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
