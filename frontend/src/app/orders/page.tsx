"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { apiRequest } from "@/lib/api";
import { CustomerNav } from "@/components/site/customer-nav";
import { CustomerPageHero } from "@/components/site/customer-page-hero";
import { CustomerAuthRedirect, useCustomerAccount } from "@/components/site/customer-account";

const DeliveryMap = dynamic(() => import("@/components/site/delivery-map").then((module) => module.DeliveryMap), { ssr: false, loading: () => <div className="tf-delivery-map tf-delivery-map-loading">Loading map…</div> });
type Order = { id:number; tracking_token:string; status:string; payment_status:string; order_type:string; table_number:string|null; dine_in_date:string|null; dine_in_time:string|null; items:{name:string;quantity:number}[]; total_cents:number; created_at:string|null; payment_method:string; delivery_latitude:number|null; delivery_longitude:number|null; rider_latitude:number|null; rider_longitude:number|null; rider_location_updated_at:string|null };
const STORAGE = "tableflow.orders.tokens.v1";
const OLD = "tableflow.order.tracking";
export default function MyOrders() {
 const {session} = useCustomerAccount();
 const [orders,setOrders] = useState<Order[]>([]);
 const [loading,setLoading] = useState(true);
 const [error,setError] = useState("");
 const load = useCallback(async () => {
  if (!session) return;
  let tokens:string[] = [];
  try {const saved:unknown = JSON.parse(localStorage.getItem(STORAGE) || "[]"); if(Array.isArray(saved)) tokens = saved.filter((s):s is string => typeof s === "string");} catch {}
  const legacy = localStorage.getItem(OLD);
  if (legacy && !tokens.includes(legacy)) tokens.unshift(legacy);
  try {
   const own = await apiRequest<Order[]>("/orders/mine",{headers:{Authorization:`Bearer ${session.accessToken}`}});
   const legacyResults = await Promise.allSettled(tokens.map(t => apiRequest<Order>(`/orders/track/${encodeURIComponent(t)}`)));
   const all = [...own,...legacyResults.filter((r):r is PromiseFulfilledResult<Order> => r.status === "fulfilled").map(r => r.value)];
   const unique = Array.from(new Map(all.map(order => [order.tracking_token, order])).values());
   setOrders(unique.sort((a,b) => b.id-a.id));
   setError("");
  } catch(issue) { setError(issue instanceof Error ? issue.message : "Could not load your orders."); }
  setLoading(false);
 },[session]);
 useEffect(() => {if(!session)return; const initial = window.setTimeout(() => void load(), 0); const t = window.setInterval(() => void load(),10000); const onFocus = () => void load(); window.addEventListener("focus", onFocus); return () => {clearTimeout(initial);clearInterval(t);window.removeEventListener("focus",onFocus)};},[load,session]);
 const retryPayment = async (o:Order) => {
  setError("");
  try {const session = await apiRequest<{checkout_url:string}>(`/orders/${o.id}/checkout`,{method:"POST",body:JSON.stringify({tracking_token:o.tracking_token})});window.location.assign(session.checkout_url);}
  catch(e){setError(e instanceof Error ? e.message : "Payment is unavailable");}
 };
 const cancel = async(o:Order) => {
  if (!confirm(`Cancel order #${o.id}?`)) return;
  setError("");
  try {await apiRequest(`/orders/track/${encodeURIComponent(o.tracking_token)}/cancel`,{method:"POST"}); await load();}
  catch(e) {setError(e instanceof Error ? e.message : "Cancellation failed");}
 };
 return <CustomerAuthRedirect><main className="tf-customer-page tf-orders-page"><CustomerNav /><CustomerPageHero image="/images/tableflow-chef.png" eyebrow="Your TableFlow orders" title="Good things are on the way." description="Follow your order from our kitchen to your table. Updates refresh automatically." className="tf-tracking-hero" /><div className="tf-orders-shell">
 {error && <p role="alert" className="food-order-error">{error}</p>}
 {loading ? <p>Loading your orders…</p> : orders.length === 0 ? <div className="tf-order-history-card"><h2>No orders on this device yet.</h2><p>Orders appear here once you place them.</p><Link href="/menu">Explore menu →</Link></div> : <div className="tf-order-history-list">{orders.map(o => <article className="tf-order-history-card" key={o.id}><div className="tf-order-history-title"><h2>Order #{o.id}</h2><span className="tf-order-pill">{o.status.replaceAll("_"," ")}</span></div><p>{o.order_type.replaceAll("_"," ")}{o.table_number ? ` · Table ${o.table_number}` : ""}{o.dine_in_date && o.dine_in_time ? ` · ${o.dine_in_date} at ${o.dine_in_time.slice(0,5)}` : ""}{o.created_at ? ` · ${new Date(o.created_at).toLocaleString()}` : ""}</p><p>{o.items.map(i=>`${i.quantity} × ${i.name}`).join(" · ")}</p><div className="tf-order-history-foot"><strong>${(o.total_cents/100).toFixed(2)}</strong><span>Payment: {o.payment_status || "UNPAID"}</span>{o.payment_method === "CARD_ONLINE" && o.payment_status !== "PAID" && o.status !== "CANCELLED" && <button onClick={()=>void retryPayment(o)}>Pay securely by card ↗</button>}{["PLACED","CONFIRMED"].includes(o.status) && o.payment_status !== "PAID" && <button onClick={()=>void cancel(o)}>Cancel order</button>}</div>{o.order_type === "DELIVERY" && <><div className="tf-order-status-path">{["PLACED","CONFIRMED","PREPARING","READY","OUT_FOR_DELIVERY","COMPLETED"].map((step,index,list)=><span key={step} className={list.indexOf(o.status)>=index ? "reached" : ""}>{step.replaceAll("_"," ")}</span>)}<small>{o.rider_location_updated_at ? `Courier location updated ${new Date(o.rider_location_updated_at).toLocaleTimeString()}.` : "Courier location appears when the delivery team shares its location."}</small></div>{o.delivery_latitude != null && o.delivery_longitude != null && <DeliveryMap destination={{latitude:o.delivery_latitude,longitude:o.delivery_longitude}} rider={o.rider_latitude != null && o.rider_longitude != null ? {latitude:o.rider_latitude,longitude:o.rider_longitude} : null} />}</>}</article>)}</div>}
 <p className="tf-order-history-note">Order details are connected to your TableFlow account. Older guest orders on this device remain visible here.</p></div></main></CustomerAuthRedirect>;
}
