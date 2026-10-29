"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest, restaurantId } from "@/lib/api";
import { CustomerNav } from "@/components/site/customer-nav";
import { FoodOrder } from "@/components/site/food-order";
import type { FoodItem } from "@/components/site/food-order";
import { CustomerPageHero } from "@/components/site/customer-page-hero";

export default function OrderPage() {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    apiRequest<FoodItem[]>(`/menu?restaurant_id=${restaurantId}`).then((data) => { if (live) setItems(data); }).catch(() => { if (live) setError("We couldn’t load the menu. Please refresh and try again."); });
    return () => { live = false; };
  }, []);
  return <main className="tf-customer-page tf-order-route">
    <CustomerNav />
    <CustomerPageHero image="/images/dish-pasta.png" eyebrow="From our kitchen, to your table" title="Make it a good meal." description="Choose a favorite, then settle in, collect, or have it brought to your door." className="tf-order-hero" />
    <div className="tf-order-intro"><Link href="/menu" className="tf-route-back">← Browse the menu</Link><p>Table orders opened from a QR code arrive with your table preselected.</p></div>
    {error ? <p className="tf-route-error" role="alert">{error}</p> : items.length === 0 ? <p className="tf-route-loading">Loading today’s menu…</p> : <FoodOrder items={items} standalone />}
  </main>;
}
