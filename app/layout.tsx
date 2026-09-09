import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tracker",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Keep the fixed bottom nav visible above the on-screen keyboard
  // (supported on Android Chrome; ignored elsewhere).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
