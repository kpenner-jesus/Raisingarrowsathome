// Brand favicon — 512×512 variant for high-density PWA install.
// Next emits a second <link rel="icon" sizes="512x512" href="/icon2">.
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function IconLarge() {
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
