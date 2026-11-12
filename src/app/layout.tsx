import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family Fantasy Football League",
  description: "View and edit the family fantasy football league",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <main>
          <SiteHeader />
          {children}
        </main>
      </body>
    </html>
  );
}
