import type { Metadata } from "next";
import "./globals.css";

const SITE = "https://raisingarrowsathome.com";
const DESC =
  "We help Christian families in Manitoba launch into homeschooling " +
  "for the very first time by providing financial assistance for " +
  "curriculum and educational resources during their first year.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    template: "%s | Raising Arrows",
    default: "Raising Arrows — First Year Homeschool Grant",
  },
  description: DESC,
  applicationName: "Raising Arrows",
  authors: [{ name: "Raising Arrows" }],
  keywords: [
    "homeschool grant", "Manitoba", "Christian homeschool",
    "first year homeschool", "curriculum reimbursement", "MACHS",
    "homeschool funding", "homeschool support",
  ],
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Raising Arrows",
    title: "Raising Arrows — First Year Homeschool Grant",
    description: DESC,
    locale: "en_CA",
  },
  twitter: {
    card: "summary",
    title: "Raising Arrows — First Year Homeschool Grant",
    description: DESC,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: { canonical: SITE },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,500;1,400&display=swap"
          rel="stylesheet"
        />
        {/* Icons + manifest are auto-emitted by app/icon.tsx,
            app/icon2.tsx, app/apple-icon.tsx, and app/manifest.ts.
            Below are PWA-only meta tags that Next doesn't add itself. */}
        <meta name="theme-color" content="#e8793a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Raising Arrows" />
      </head>
      <body>{children}</body>
    </html>
  );
}
