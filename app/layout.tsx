import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "アクセルダッシュ",
  description: "アプリ管理ポータル",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 dark:bg-slate-950">
        {children}
      </body>
    </html>
  );
}
