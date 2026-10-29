"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiBaseUrl, apiRequest, restaurantId } from "@/lib/api";
import { CustomerNav } from "@/components/site/customer-nav";
import { CustomerPageHero } from "@/components/site/customer-page-hero";

type Dish = { id: number; name: string; detail: string; category: string; image: string; price_cents: number; available: boolean };
export default function FullMenuPage() {
  const router = useRouter();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [category, setCategory] = useState("All");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const data = await apiRequest<Dish[]>(`/menu?restaurant_id=${restaurantId}`); if (active) setDishes(data); }
      catch { if (active) setError("Unable to load the menu. Please refresh and try again."); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const available = dishes.filter(d => d.available);
  const shown = category === "All" ? available : available.filter(d => d.category === category);
  const openDish = (id: number) => {
    const params = new URLSearchParams({ item: String(id) });
    const table = new URLSearchParams(window.location.search).get("table");
    if (table && /^[\w-]{1,16}$/.test(table)) params.set("table", table);
    router.push(`/order?${params.toString()}`);
  };
  const startOrder = () => {
    const table = new URLSearchParams(window.location.search).get("table");
    router.push(table && /^[\w-]{1,16}$/.test(table) ? `/order?table=${encodeURIComponent(table)}` : "/order");
  };
  return <main className="tf-full-menu-page">
    <CustomerNav />
    <CustomerPageHero image="/images/dish-scallop.png" eyebrow="The TableFlow menu" title="A little wonder, on every plate." description="A seasonal collection from our kitchen. Find a favorite, then choose dine-in, collection, or delivery." className="tf-menu-hero" />
    <section className="menu-section" aria-label="Full food menu"><div className="shell">
      <div className="tf-menu-section-heading"><div><p className="section-mark">SEASONAL · THOUGHTFUL · DELICIOUS</p><h2>Made to be remembered.</h2></div><p>Explore the kitchen’s current favorites, prepared with care and ready to share.</p></div>
      <div className="menu-filter" aria-label="Menu categories">
        {["All", ...Array.from(new Set(available.map(d => d.category)))].map(c =>
          <button key={c} onClick={() => setCategory(c)} className={category === c ? "is-active" : ""}>{c}</button>)}
      </div>
      {error && <p role="alert">{error}</p>}
      {shown.length === 0 && !error && <p>No dishes in this category yet.</p>}
      <div className="dish-grid">{shown.map((dish, index) => <article key={dish.id} className="dish-card">
        <div className="dish-card__media"><Image className="dish-card__photo" src={dish.image.startsWith("/api/v1/") ? `${apiBaseUrl.replace(/\/api\/v1$/, "")}${dish.image}` : dish.image} alt={dish.name} fill unoptimized sizes="(max-width: 590px) 100vw, (max-width: 900px) 50vw, 33vw" /><span className="dish-card__count">{String(index + 1).padStart(2,"0")}</span></div>
        <div className="dish-card__body"><div><h3>{dish.name}</h3><p>{dish.detail}</p></div><div className="dish-card__bottom"><strong>${(dish.price_cents/100).toFixed(2)}</strong><button aria-label={`Add ${dish.name} to order`} onClick={() => openDish(dish.id)}>→</button></div></div>
      </article>)}</div>
    </div></section>
    <div className="shell tf-menu-order-cta"><button onClick={startOrder}>Choose collection or delivery <span aria-hidden="true">↗</span></button><Link href="/orders">Track an order</Link></div>
  </main>;
}
