"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Nav.module.css";

const links = [
  { href: "/", label: "Add" },
  { href: "/entries", label: "Entries" },
  { href: "/import", label: "Import" },
  { href: "/periods", label: "Periods" },
  { href: "/categories", label: "Categories" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={pathname === href ? styles.active : styles.link}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
