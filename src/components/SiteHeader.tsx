import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span>Family Fantasy</span>
        Football League
      </Link>
      <nav className="nav" aria-label="Main">
        <Link href="/">League</Link>
        <Link href="/players" className="secondary">
          Players
        </Link>
      </nav>
    </header>
  );
}
