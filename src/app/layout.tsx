import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaBoot from "@/components/PwaBoot";
export const metadata: Metadata = {
  title: "Chat",
  description: "A simple place for conversations, teams and ideas.",
  manifest: "/manifest.webmanifest",
  applicationName: "Chat",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Chat" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-180.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8fafd",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/google-sans-latin-variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/roboto-latin-variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <PwaBoot />
        {children}
      </body>
    </html>
  );
}
