import type { Metadata } from "next";
import "@fontsource-variable/golos-text";
import "@fontsource-variable/unbounded";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TRON Flow", template: "%s — TRON Flow" },
  description: "Потоки USDT TRC-20 по адресной книге: ликвидность, граф связей, паттерны, уведомления",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
