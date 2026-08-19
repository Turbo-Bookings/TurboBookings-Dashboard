import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { GOOGLE_FONTS_URL } from "@/lib/fonts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TurboBookings Dashboard",
  description:
    "Multi-tenant client portal for ATV-tour location buildouts and ops.",
  // Installable to the Home Screen. On iOS this is not cosmetic: Apple only
  // permits web push from a Home-Screen-installed app, so the PWA shell is a
  // prerequisite for new-booking alerts, not just nicer chrome.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TurboBookings",
    // "default" keeps the iOS status bar legible over our light header; "black-translucent"
    // would let content slide under the clock.
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  // Operators use this one-handed on a phone at the trailhead; a fixed width
  // with pinch-zoom left enabled avoids trapping anyone who needs to zoom.
  width: "device-width",
  initialScale: 1,
  // Keeps the standalone app clear of the iPhone notch and home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <head>
          {/* Preloads the customer-facing font catalog used by the
              per-location Visual Identity picker so previews render
              instantly when the dropdown opens. */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
        </head>
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
