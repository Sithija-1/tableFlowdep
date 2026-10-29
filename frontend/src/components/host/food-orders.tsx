"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, restaurantId } from "@/lib/api";

type Order = {
  id: number; customer_name: string; customer_phone: string | null; order_type: string; table_number: string | null;
  dine_in_date: string | null; dine_in_time: string | null;
  delivery_address: string | null; payment_method: string; payment_status: string; status: string;
  total_cents: number; created_at: string | null;
  delivery_latitude: number | null; delivery_longitude: number | null;
  rider_latitude: number | null; rider_longitude: number | null;
  rider_location_updated_at: string | null;
  items: { name: string; quantity: number }[];
};
const actions: Record<string, string[]> = {
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY"],
  READY: ["COMPLETED", "OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["COMPLETED"],
};
export function FoodOrders({ token }: { token: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [sharingLocationFor, setSharingLocationFor] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const lastLocationSentAt = useRef(0);
  const load = useCallback(async () => {
    try { setOrders(await apiRequest<Order[]>(`/orders?restaurant_id=${restaurantId}`, { headers: { Authorization: `Bearer ${token}` } })); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Cannot fetch orders"); }
  }, [token]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 8000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => () => {
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
  }, []);
  const change = async (id: number, status: string) => {
    if (status === "CANCELLED" && !window.confirm("Cancel this order?")) return;
    setBusy(id);
    try {
      await apiRequest(`/orders/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ status }) });
      await load();
      if (status === "OUT_FOR_DELIVERY") toggleLocationSharing(id);
    } catch (err) { setError(err instanceof Error ? err.message : "Update failed"); }
    finally { setBusy(null); }
  };
  const markPaid = async (id: number) => {
    if (!window.confirm("Confirm that payment has actually been received for this order?")) return;
    setBusy(id); setError("");
    try {
      await apiRequest(`/orders/${id}/payment`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not record payment"); }
    finally { setBusy(null); }
  };
  const toggleLocationSharing = (orderId: number) => {
    if (sharingLocationFor === orderId && watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setSharingLocationFor(null);
      return;
    }
    if (!navigator.geolocation) {
      setError("This device does not support GPS location sharing.");
      return;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    lastLocationSentAt.current = 0;
    setError("");
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastLocationSentAt.current < 5000) return;
        lastLocationSentAt.current = now;
        void apiRequest(`/orders/${orderId}/location`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        }).then(() => void load()).catch((err) => setError(err instanceof Error ? err.message : "Could not share delivery location"));
      },
      () => {
        setError("Location access failed. Allow location permission on this dispatch device.");
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
        setSharingLocationFor(null);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setSharingLocationFor(orderId);
  };
  return <section className="host-task-panel food-orders-panel">
    <div className="host-task-heading"><p>Kitchen & collection</p><h2>Customer orders</h2><span>Dine-in · takeaway · delivery. Orders refresh automatically.</span></div>
    <button className="food-orders-refresh" onClick={() => void load()}>Refresh orders ↻</button>
    {error && <p role="alert">{error}</p>}
    {!orders.length && <p>No orders have been placed yet.</p>}
    <div className="tf-order-tabs"><button className={!archive ? "selected" : ""} onClick={() => setArchive(false)}>Latest orders ({Math.min(3, orders.length)})</button><button className={archive ? "selected" : ""} onClick={() => setArchive(true)}>Older orders ({Math.max(0, orders.length - 3)})</button></div>
    {archive && orders.length <= 3 && <p>No older orders yet.</p>}
    {(archive ? orders.slice(3) : orders.slice(0, 3)).map((order) => <article className="food-orders-card" key={order.id}>
      <header><div><strong>Order #{order.id} · {order.customer_name}</strong><small>{order.order_type.replaceAll("_", " ")}{order.table_number ? ` · Table ${order.table_number}` : ""}{order.dine_in_date && order.dine_in_time ? ` · ${order.dine_in_date} at ${order.dine_in_time.slice(0, 5)}` : ""}{order.customer_phone ? ` · ${order.customer_phone}` : ""}</small></div><span>{order.status.replaceAll("_", " ")}</span></header>
      <p>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}</p>
      {order.delivery_address && <p>Deliver to: {order.delivery_address}</p>}
      {order.order_type === "DELIVERY" && order.status === "OUT_FOR_DELIVERY" && <p className="tf-host-location-note">{order.rider_location_updated_at ? `Last GPS update: ${new Date(order.rider_location_updated_at).toLocaleTimeString()}` : "Share this device's GPS to show the courier on the customer's map."}</p>}
      <p>${(order.total_cents / 100).toFixed(2)} · {order.payment_method.replaceAll("_", " ")} · {order.payment_status || "UNPAID"}</p>
      <div className="food-orders-controls">{order.payment_status !== "PAID" && order.payment_method !== "CARD_ONLINE" && order.status !== "CANCELLED" && <button disabled={busy === order.id} onClick={() => void markPaid(order.id)}>Mark Paid ✓</button>}{(actions[order.status] || []).filter((status) => status !== "OUT_FOR_DELIVERY" || order.order_type === "DELIVERY").map((status) => <button key={status} disabled={busy === order.id} onClick={() => void change(order.id, status)}>{status.replaceAll("_", " ")}</button>)}{order.order_type === "DELIVERY" && order.status === "OUT_FOR_DELIVERY" && <button className={sharingLocationFor === order.id ? "tf-location-sharing" : ""} onClick={() => toggleLocationSharing(order.id)}>{sharingLocationFor === order.id ? "Stop sharing GPS" : "Share live GPS"}</button>}</div>
    </article>)}
  </section>;
}
