"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

/** The dark sidebar shared by Admin Studio and the POS demo. Below 900px it folds into a top bar with a menu button. */
export function Sidebar({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <aside className="sidebar" data-open={open || undefined}>
      <div className="sidebar-top">
        {brand}
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="sidebar-body"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      {/* Picking a menu item closes the mobile menu, whether it is a route link or an in-page view. */}
      <div id="sidebar-body" className="sidebar-body" onClick={(e) => (e.target as Element).closest(".nav-item") && setOpen(false)}>
        {children}
      </div>
    </aside>
  );
}

export function SidebarBrand({ logo, name, sub, href }: { logo: ReactNode; name: string; sub?: string; href?: string }) {
  const inner = (
    <>
      <span className="sidebar-logo" aria-hidden>
        {logo}
      </span>
      <span>
        <span className="sidebar-name">{name}</span>
        {sub && <span className="sidebar-sub">{sub}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="sidebar-brand">
      {inner}
    </Link>
  ) : (
    <div className="sidebar-brand">{inner}</div>
  );
}

/** A route link that marks itself current when the path is it or below it. */
export function NavLink({ href, icon, children }: { href: string; icon: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link href={href} className="nav-item" aria-current={current ? "page" : undefined}>
      <span className="nav-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </Link>
  );
}
