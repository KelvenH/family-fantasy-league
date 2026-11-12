"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  const onPlayers = pathname.startsWith("/players");

  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span>Family Fantasy</span>
        Football League
      </Link>
      <nav className="nav" aria-label="Main">
        <Link href="/" aria-current={onPlayers ? undefined : "page"}>
          League
        </Link>
        <Link href="/players" aria-current={onPlayers ? "page" : undefined}>
          Players
        </Link>
      </nav>
    </header>
  );
}
