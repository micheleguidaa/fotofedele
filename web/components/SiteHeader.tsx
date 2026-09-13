"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Foto" },
  { href: "/numeri", label: "Numeri" },
  { href: "/metodo", label: "Metodo" },
  { href: "/arena", label: "Arena" },
];

export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
      <path d="M6 12.2 12 7l6 5.2V18H6z" fill="none" stroke="var(--on-accent)" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m9.4 13.9 1.8 1.8 3.5-3.7" fill="none" stroke="var(--on-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight" aria-label="FotoFedele, pagina iniziale">
          <LogoMark className="hidden size-6 min-[440px]:block" />
          <span className="text-[15px] sm:text-base">FotoFedele</span>
        </Link>
        <nav aria-label="Principale" className="-mr-2 ml-auto overflow-x-auto">
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" || pathname.startsWith("/foto/") : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "block rounded-md px-1.5 py-1.5 text-sm whitespace-nowrap transition-colors sm:px-3",
                      active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-subtle hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
