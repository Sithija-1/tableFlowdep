"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ShoppingBag } from "lucide-react";

export function CustomerNav() {
  const pathname = usePathname();
  const links = [{ href: "/menu", label: "Menu" }, { href: "/reserve", label: "Reservations" }, { href: "/order", label: "Order" }, { href: "/orders", label: "Track order" }];
  return <header className="tf-customer-nav"><Link className="tf-customer-brand" href="/" aria-label="TableFlow home"><span className="monogram monogram--inverse">TF</span><span>TableFlow</span></Link><nav aria-label="Customer navigation">{links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav><Link className="tf-customer-nav-cta" href="/order"><ShoppingBag aria-hidden="true" /><span className="tf-customer-nav-cta__copy"><strong>Order now</strong><small>Collection or delivery</small></span><ArrowUpRight aria-hidden="true" /></Link></header>;
}
