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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Source+Sans+3:wght@400;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <main>
          <SiteHeader />
          {children}
        </main>
      </body>
    </html>
  );
}
