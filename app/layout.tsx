import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accel Dash",
  description: "App Management Portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 dark:bg-slate-950">
        {children}
      </body>
    </html>
  );
}