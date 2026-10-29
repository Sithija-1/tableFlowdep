"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { MapPin, ShoppingBag, Utensils } from "lucide-react";
import { apiBaseUrl, apiRequest, fetchFloorAvailability, restaurantId } from "@/lib/api";
import { useCustomerAccount } from "@/components/site/customer-account";
import type { TableFloorInfo } from "@/lib/api";
import type { GeoPoint } from "./delivery-map";

const DeliveryMap = dynamic(() => import("./delivery-map").then((module) => module.DeliveryMap), {
  ssr: false,
  loading: () => <div className="tf-delivery-map tf-delivery-map-loading">Loading map…</div>,
});

export type FoodItem = { id: number; name: string; detail: string; price_cents: number; available: boolean; category: string; image: string };
type Mode = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
type Line = { item_id: string; name: string; quantity: number; unit_cents: number };
type Payment = "CASH" | "CARD_ON_ARRIVAL" | "CARD_ONLINE" | "SIMULATED_CARD";
type Order = { id: number; tracking_token: string; status: string; payment_status?: string; payment_method?: Payment; order_type: Mode; items: Line[]; total_cents: number; table_number: string | null; dine_in_date?: string | null; dine_in_time?: string | null; delivery_address?: string | null; delivery_latitude?: number | null; delivery_longitude?: number | null; rider_latitude?: number | null; rider_longitude?: number | null; rider_location_updated_at?: string | null };
const KEY = "tableflow.order.tracking";
const ORDER_DRAFT_KEY = "tableflow.order.draft.v1";
export const ORDERS_KEY = "tableflow.orders.tokens.v1";
function saveOrderToken(token: string) {
  try {
    const old = JSON.parse(window.localStorage.getItem(ORDERS_KEY) || "[]") as unknown;
    const tokens = Array.isArray(old) ? old.filter((value): value is string => typeof value === "string") : [];
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify([token, ...tokens.filter(t => t !== token)].slice(0, 100)));
    window.dispatchEvent(new Event("tableflow-orders-updated"));
  } catch { window.localStorage.setItem(ORDERS_KEY, JSON.stringify([token])); }
}

export function FoodOrder({ items, standalone = false }: { items: FoodItem[]; standalone?: boolean }) {
  const { session } = useCustomerAccount();
  const router = useRouter();
  const [open, setOpen] = useState(standalone);
  const [mode, setMode] = useState<Mode>("DINE_IN");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [table, setTable] = useState("");
  const [dineInDate, setDineInDate] = useState("");
  const [dineInTime, setDineInTime] = useState("19:00");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState<GeoPoint | null>(null);
  const [payment, setPayment] = useState<Payment>("CASH");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [available, setAvailable] = useState<TableFloorInfo[]>([]);
  const [availableForSlot, setAvailableForSlot] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showTrack, setShowTrack] = useState(false);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [showCart, setShowCart] = useState(true);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const tableAvailabilityLoading = open && mode === "DINE_IN" && Boolean(dineInDate) && availableForSlot !== `${dineInDate}T${dineInTime}`;
  const categories = useMemo(() => ["All", ...Array.from(new Set(items.filter(item => item.available).map(item => item.category.trim() || "Other")))], [items]);
  const visibleItems = items.filter(item => item.available && (category === "All" || (item.category.trim() || "Other") === category) && `${item.name} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()));

  const refresh = async (token: string) => {
    try { setOrder(await apiRequest<Order>(`/orders/track/${encodeURIComponent(token)}`)); }
    catch { /* A removed or expired order can be retried manually. */ }
  };
  const change = (id: string, delta: number) => setCart((prev) => ({ ...prev, [id]: Math.max(0, Math.min(30, (prev[id] || 0) + delta)) }));
  useEffect(() => {
    const onOpen = (event: Event) => { const id = (event as CustomEvent<number>).detail; if (typeof id === "number") change(String(id), 1); setOpen(true); setShowTrack(false); };
    window.addEventListener("tableflow-open-order", onOpen);
    const params = new URLSearchParams(window.location.search);
    const qrTable = params.get("table");
    // The URL seeds editable form state when a QR or menu link opens this route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (qrTable && /^[\w-]{1,16}$/.test(qrTable)) { setMode("DINE_IN"); setTable(qrTable); setOpen(true); }
    const itemId = params.get("item");
    if (itemId && /^\d+$/.test(itemId)) setCart((current) => ({ ...current, [itemId]: Math.max(1, current[itemId] || 0) }));
    if (params.has("order")) setOpen(true);
    const token = window.localStorage.getItem(KEY);
    if (token) { saveOrderToken(token); void refresh(token); }
    return () => window.removeEventListener("tableflow-open-order", onOpen);
  }, []);
  useEffect(() => {
    if (!session) return;
    try {
      const draft = sessionStorage.getItem(ORDER_DRAFT_KEY);
      if (!draft) {
        // Seed from the external account session when there is no pending checkout draft.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhone(current => current || session.user.phone || "");
        return;
      }
      const saved = JSON.parse(draft) as { cart?: Record<string, number>; mode?: Mode; table?: string; phone?: string; address?: string; deliveryLocation?: GeoPoint | null; payment?: Payment };
      if (saved.cart) setCart(saved.cart);
      if (saved.mode && ["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(saved.mode)) setMode(saved.mode);
      if (saved.table) setTable(saved.table);
      setPhone(saved.phone || session.user.phone || "");
      if (saved.address) setAddress(saved.address);
      if (saved.deliveryLocation) setDeliveryLocation(saved.deliveryLocation);
      if (saved.payment) setPayment(saved.payment);
      sessionStorage.removeItem(ORDER_DRAFT_KEY);
    } catch {
      sessionStorage.removeItem(ORDER_DRAFT_KEY);
    }
  }, [session]);
  useEffect(() => {
    if (!open || mode !== "DINE_IN" || !dineInDate || !dineInTime) return;
    let live = true;
    // Today's physical availability, not a future reservation slot.
    const load = async () => {
      try {
        const slotStart = `${dineInTime}:00`;
        const result = await fetchFloorAvailability(dineInDate, slotStart, 2);
        const params = new URLSearchParams({ restaurant_id: String(restaurantId), reservation_date: dineInDate, slot_start: slotStart });
        const occupied = await apiRequest<{table_numbers: string[]}>(`/orders/occupied-tables?${params}`);
        if (live) {
          setAvailable(result.map(t => ({...t, available: t.available && !occupied.table_numbers.includes(t.number)})));
          setAvailableForSlot(`${dineInDate}T${dineInTime}`);
        }
      } catch { if (live) { setError("Could not load tables. Please try again."); setAvailable([]); setAvailableForSlot(`${dineInDate}T${dineInTime}`); } }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [open, mode, dineInDate, dineInTime]);
  useEffect(() => {
    if (!open || !order || order.status === "COMPLETED" || order.status === "CANCELLED") return;
    const id = window.setInterval(() => void refresh(order.tracking_token), 8000);
    return () => window.clearInterval(id);
  }, [open, order]);
  useEffect(() => {
    if (mode === "DINE_IN" && table && available.length && !available.some(t => t.number === table && t.available)) {
      // Clear a previously selected table when live availability revokes it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTable("");
      setError("That table is no longer available. Please select another table.");
    }
  }, [available, mode, table]);
  const quantity = items.filter(i => i.available).reduce((sum, i) => sum + (cart[String(i.id)] || 0), 0);
  const total = items.filter(item => item.available).reduce((sum, item) => sum + (cart[String(item.id)] || 0) * item.price_cents, 0) / 100;
  const place = async () => {
    setError("");
    if (!quantity) { setError("Add at least one dish to your cart before continuing."); return; }
    if (!/^\+?[0-9][0-9\s().-]{5,30}$/.test(phone.trim())) { setError("Enter a valid phone number so the restaurant can contact you about your order."); return; }
    if (mode === "DINE_IN" && !table) { setError("Choose an available table for dine-in."); return; }
    if (mode === "DINE_IN" && (!dineInDate || !dineInTime)) { setError("Choose your dine-in date and arrival time."); return; }
    if (mode === "DELIVERY" && (!address.trim() || !deliveryLocation)) { setError(!deliveryLocation ? "Select your delivery location on the map before placing the order." : "Enter your delivery address before continuing."); return; }
    if (!session) {
      sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({ cart, mode, table, phone, address, deliveryLocation, payment }));
      const returnTo = `${window.location.pathname}${window.location.search}`;
      router.push(`/account/sign-in?next=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBusy(true);
    try {
      const created = await apiRequest<Order>("/orders", { method: "POST", body: JSON.stringify({
        restaurant_id: restaurantId, customer_name: session.user.full_name, customer_phone: phone.trim(), order_type: mode,
        table_number: mode === "DINE_IN" ? table : null,
        dine_in_date: mode === "DINE_IN" ? dineInDate : null,
        dine_in_time: mode === "DINE_IN" ? `${dineInTime}:00` : null,
        delivery_address: mode === "DELIVERY" ? address.trim() : null,
        delivery_latitude: mode === "DELIVERY" ? deliveryLocation?.latitude : null,
        delivery_longitude: mode === "DELIVERY" ? deliveryLocation?.longitude : null,
        payment_method: payment,
        ...(payment === "SIMULATED_CARD" ? { card_number: cardNumber, card_expiry: cardExpiry, card_cvv: cardCvv } : {}),
        items: items.filter((i) => i.available && cart[String(i.id)]).map((i) => ({ item_id: i.id, quantity: cart[String(i.id)] })),
      }), headers: { Authorization: `Bearer ${session.accessToken}` } });
      setOrder(created); window.localStorage.setItem(KEY, created.tracking_token); saveOrderToken(created.tracking_token);
      setCart({}); setCardNumber(""); setCardExpiry(""); setCardCvv(""); setShowTrack(true);
      if (payment === "CARD_ONLINE") {
        const session = await apiRequest<{ checkout_url: string }>(`/orders/${created.id}/checkout`, { method: "POST", body: JSON.stringify({ tracking_token: created.tracking_token }) });
        window.location.assign(session.checkout_url);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Order could not be placed."); }
    finally { setBusy(false); }
  };
  const useCurrentLocation = () => {
    setError("");
    if (!navigator.geolocation) {
      setError("Location access is not available in this browser. Select your location on the map.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setDeliveryLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setError("Could not read your location. Allow location access or select it on the map."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };
  const cancel = async () => {
    if (!order || !window.confirm("Cancel this order?")) return;
    setBusy(true); setError("");
    try { const next = await apiRequest<Order>(`/orders/track/${encodeURIComponent(order.tracking_token)}/cancel`, { method: "POST" }); setOrder(next); }
    catch (err) { setError(err instanceof Error ? err.message : "Cannot cancel this order."); }
    finally { setBusy(false); }
  };
  return <>
    <div className={standalone ? "food-order-page" : ""}>
    {!standalone && <div className="food-order-actions">
      <button onClick={() => { setOpen(true); setShowTrack(false); }}>Order food {quantity ? `(${quantity})` : ""} →</button>
      <Link href="/orders" className="tf-my-orders-link">My orders <span aria-hidden="true">↗</span></Link>
    </div>}
    {open && <div className={`food-order-overlay${standalone ? " food-order-overlay--page" : ""}`} onMouseDown={(e) => { if (!standalone && e.target === e.currentTarget) setOpen(false); }}>
      <section className="food-order-dialog" role={standalone ? undefined : "dialog"} aria-modal={standalone ? undefined : true} aria-label="Food ordering">
        <div className="food-order-top"><span className="section-mark">TABLEFLOW · ORDERING</span>{!standalone && <button onClick={() => setOpen(false)} aria-label="Close">✕</button>}</div>
        <h2>{showTrack && order ? `Order #${order.id}` : "Order at your pace."}</h2>
        {!session && !showTrack && <p className="tf-order-signin-note">Build your cart first. We’ll keep it ready while you sign in to place your order.</p>}
        {showTrack && order ? <div className="food-order-track">
          <p>Your order status</p><strong>{order.status.replaceAll("_", " ")}</strong>
          <p>{order.order_type.replaceAll("_", " ")} {order.table_number ? `· Table ${order.table_number}` : ""}{order.dine_in_date && order.dine_in_time ? ` · ${order.dine_in_date} at ${order.dine_in_time.slice(0, 5)}` : ""}</p>
          <p>{order.items.map((line) => `${line.quantity} × ${line.name}`).join(" · ")}</p>
          <p>Total: ${(order.total_cents / 100).toFixed(2)}</p>
          <p>Payment status: {order.payment_status || "UNPAID"}</p>
          {order.order_type === "DELIVERY" && <><div className="tf-delivery-progress"><p>Delivery progress</p>{["PLACED", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"].map((step, index, list) => <div key={step} className={list.indexOf(order.status) >= index ? "reached" : ""}>● {step.replaceAll("_", " ")}</div>)}<small>{order.rider_location_updated_at ? `Courier location updated ${new Date(order.rider_location_updated_at).toLocaleTimeString()}.` : "Courier location appears when the delivery team shares its location."}</small></div>{order.delivery_latitude != null && order.delivery_longitude != null && <DeliveryMap destination={{ latitude: order.delivery_latitude, longitude: order.delivery_longitude }} rider={order.rider_latitude != null && order.rider_longitude != null ? { latitude: order.rider_latitude, longitude: order.rider_longitude } : null} />}</>}
          <p>Your order updates automatically every few seconds.</p>
          {(["PLACED", "CONFIRMED"].includes(order.status)) && <button className="food-order-secondary" disabled={busy} onClick={cancel}>Cancel order</button>}
          <button onClick={() => setShowTrack(false)}>Create another order</button>
        </div> : <>
          <div className="tf-order-builder"><div className="tf-order-main">
          <div className="tf-order-checkout-heading"><span>01</span><div><strong>How would you like it?</strong><small>Choose dine in, collection or delivery</small></div></div>
          <div className="food-order-modes" role="group" aria-label="How would you like your order?">{(["DINE_IN", "TAKEAWAY", "DELIVERY"] as Mode[]).map((m) => <button type="button" aria-pressed={mode === m} className={mode === m ? "selected" : ""} onClick={() => { setMode(m); if (m !== "DELIVERY" && payment === "SIMULATED_CARD") setPayment("CASH"); setError(""); }} key={m}>{m === "DINE_IN" ? <Utensils aria-hidden="true" /> : m === "TAKEAWAY" ? <ShoppingBag aria-hidden="true" /> : <MapPin aria-hidden="true" />}<span><strong>{m === "DINE_IN" ? "Dine in" : m === "TAKEAWAY" ? "Collection" : "Delivery"}</strong><small>{m === "DINE_IN" ? "Enjoy it at your table" : m === "TAKEAWAY" ? "Pick up when ready" : "Bring it to your door"}</small></span><i aria-hidden="true" /></button>)}</div>
          {session && <div className="food-order-account"><span>Ordering as</span><strong>{session.user.full_name}</strong><small>{session.user.email}</small></div>}
          <label>Contact phone<input required type="tel" autoComplete="tel" minLength={7} maxLength={32} pattern="[+]?[0-9][0-9 () .-]{5,30}" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+94 77 123 4567" /><small>The restaurant will use this number if it needs to contact you.</small></label>
          {mode === "DINE_IN" && <><div className="tf-order-dining-slot"><label>Dining date<input type="date" min={today} value={dineInDate} onChange={event => { setDineInDate(event.target.value); setTable(""); setAvailable([]); }} required /></label><label>Arrival time<input type="time" step={900} value={dineInTime} onChange={event => { setDineInTime(event.target.value); setTable(""); setAvailable([]); }} required /></label></div><label>Available table<select value={table} onChange={(e) => setTable(e.target.value)} disabled={!dineInDate || tableAvailabilityLoading}><option value="">{!dineInDate ? "Choose a date to check tables" : tableAvailabilityLoading ? "Checking availability…" : "Select a table"}</option>{available.filter(t => t.available && t.fits_party).map((t) => <option key={t.id} value={t.number}>{t.number} · {t.capacity} seats</option>)}</select><small>Availability includes existing reservations and other dine-in orders for your selected time.</small></label>{dineInDate && !tableAvailabilityLoading && available.length === 0 && <p className="tf-order-availability-note">No tables are available at this time. Choose a different arrival time.</p>}</>}
          {mode === "DELIVERY" && <div className="tf-delivery-location"><label>Delivery address<textarea value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town and delivery instructions" /></label><div className="tf-delivery-location__heading"><strong>Pin your delivery location</strong><button type="button" onClick={useCurrentLocation}>Use my location</button></div><p>Tap the map to place the pin. The map pin is required before you can order.</p><DeliveryMap destination={deliveryLocation} onSelect={setDeliveryLocation} />{deliveryLocation && <small>Selected: {deliveryLocation.latitude.toFixed(5)}, {deliveryLocation.longitude.toFixed(5)}</small>}</div>}
          <div className="tf-shop-heading"><div><span className="section-mark">02 · THE MENU</span><h3>Choose your dishes</h3></div><span>{items.filter(i => i.available).length} dishes</span></div>
          <div className="tf-shop-search"><span aria-hidden="true">⌕</span><input aria-label="Search dishes" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search dishes, ingredients…" /></div>
          <div className="tf-shop-categories" role="group" aria-label="Menu categories">{categories.map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
          <div className="tf-shop-grid">{visibleItems.map(item => <article className="tf-shop-dish" key={item.id}>
            <div className="tf-shop-photo">{item.image ? <Image src={item.image.startsWith("/api/v1/") ? `${apiBaseUrl.replace(/\/api\/v1$/, "")}${item.image}` : item.image} alt={item.name} width={240} height={240} unoptimized /> : <span aria-hidden="true">✦</span>}</div>
            <div className="tf-shop-copy"><span className="tf-shop-category">{item.category || "Other"}</span><strong>{item.name}</strong><small>{item.detail || "Freshly prepared"}</small><div className="tf-shop-item-bottom"><b>${(item.price_cents / 100).toFixed(2)}</b><div className="food-order-qty">{cart[String(item.id)] ? <><button aria-label={`Remove ${item.name}`} onClick={() => change(String(item.id), -1)}>−</button><span>{cart[String(item.id)]}</span></> : null}<button aria-label={`Add ${item.name}`} onClick={() => change(String(item.id), 1)}>{cart[String(item.id)] ? "+" : "+ Add"}</button></div></div></div>
          </article>)}</div>
          {visibleItems.length === 0 && <p className="tf-shop-empty">No dishes match this selection. Try another category or search.</p>}
          </div><aside className="tf-order-checkout">
          <div className="tf-order-checkout-heading"><span>03</span><div><strong>Your order</strong><small>Review and pay securely</small></div></div>
          <button className="tf-cart-toggle" onClick={() => setShowCart(v => !v)} aria-expanded={showCart}>Your cart <span>{quantity} {quantity === 1 ? "item" : "items"} · ${total.toFixed(2)} {showCart ? "⌃" : "⌄"}</span></button>
          {showCart && <div className="tf-cart-review">{items.filter(i => i.available && cart[String(i.id)]).map(i => <div key={i.id}><span>{cart[String(i.id)]} × {i.name}</span><strong>${((cart[String(i.id)] || 0) * i.price_cents / 100).toFixed(2)}</strong><button type="button" className="tf-cart-remove" aria-label={`Remove ${i.name} from cart`} onClick={() => change(String(i.id), -(cart[String(i.id)] || 0))}>Remove</button></div>)}{quantity === 0 && <p>Choose a dish to start your order.</p>}</div>}
          <label>Payment method<select value={payment === "SIMULATED_CARD" && mode !== "DELIVERY" ? "CASH" : payment} onChange={(e) => setPayment(e.target.value as Payment)}><option value="CASH">{mode === "TAKEAWAY" ? "Cash on collection" : mode === "DELIVERY" ? "Cash on delivery" : "Cash at restaurant"}</option>{mode === "DELIVERY" ? <option value="SIMULATED_CARD">Card payment · simulated checkout</option> : <><option value="CARD_ON_ARRIVAL">{mode === "TAKEAWAY" ? "Card on collection" : "Card at restaurant"}</option><option value="CARD_ONLINE">Pay now by card (secure Stripe checkout)</option></>}</select></label>
          {payment === "SIMULATED_CARD" && mode === "DELIVERY" && <div className="tf-card-notice"><strong>Simulated card checkout</strong><label>Card number<input inputMode="numeric" autoComplete="cc-number" value={cardNumber} onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, "").slice(0, 23))} /></label><div className="tf-card-fields"><label>Expiry<input inputMode="numeric" autoComplete="cc-exp" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value.replace(/[^\d/]/g, "").slice(0, 5))} placeholder="MM/YY" /></label><label>Security code<input inputMode="numeric" autoComplete="cc-csc" value={cardCvv} onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="CVV" /></label></div></div>}
          {payment === "CARD_ONLINE" && <div className="tf-card-notice"><strong>Secure card payment</strong><p>After clicking Place order, Stripe opens a protected checkout to enter your card number, expiry date and CVC. Stripe validates the details. TableFlow never collects or stores your card number.</p><small>Requires Stripe keys configured by the restaurant. Your order remains unpaid until payment is confirmed.</small></div>}
          <div className="food-order-total"><span>{quantity} items</span><strong>${total.toFixed(2)}</strong></div>
          {error && <p className="food-order-error" role="alert">{error}</p>}
          <button className="food-order-submit" disabled={busy || quantity === 0} onClick={() => void place()}>{busy ? "Placing…" : "Place order"} →</button>
          </aside></div>
        </>}
      </section>
    </div>}
    </div>
  </>;
}
