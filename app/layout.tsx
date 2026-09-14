import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Sea Radar",
  description: "Учебная карта движения судов",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
