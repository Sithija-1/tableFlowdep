"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { apiRequest, fetchFloorAvailability, restaurantId } from "@/lib/api";
import type { TableFloorInfo } from "@/lib/api";
import { RestaurantFloor } from "@/components/site/restaurant-floor";
import { CustomerNav } from "@/components/site/customer-nav";
import { CustomerPageHero } from "@/components/site/customer-page-hero";
import { CustomerAuthRedirect, useCustomerAccount } from "@/components/site/customer-account";

const slots = [{ label: "5:30 PM", value: "17:30:00" }, { label: "7:00 PM", value: "19:00:00" }, { label: "8:30 PM", value: "20:30:00" }];
function restaurantDate(offset: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (key: string) => parts.find(part => part.type === key)?.value ?? "";
  const date = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")) + offset));
  return date.toISOString().slice(0, 10);
}
function subscribeToClock(notify: () => void) { const timer = window.setInterval(notify, 60_000); return () => window.clearInterval(timer); }
const getRestaurantToday = () => restaurantDate(0);
const getRestaurantTomorrow = () => restaurantDate(1);
const getServerDate = () => "";
type Reservation = { table_number: string };

export default function ReservePage() {
  const { session } = useCustomerAccount();
  const minDate = useSyncExternalStore(subscribeToClock, getRestaurantToday, getServerDate);
  const defaultDate = useSyncExternalStore(subscribeToClock, getRestaurantTomorrow, getServerDate);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const date = selectedDate && selectedDate >= minDate ? selectedDate : defaultDate;
  const [time, setTime] = useState(slots[1].value);
  const [guests, setGuests] = useState(2);
  const [tables, setTables] = useState<TableFloorInfo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [step, setStep] = useState<"details" | "tables" | "done">("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (step !== "tables") return;
    let live = true;
    const load = async () => {
      try { const result = await fetchFloorAvailability(date, time, guests); if (live) { setTables(result); if (selected && !result.some(table => table.id === selected && table.available && table.fits_party)) setSelected(null); } }
      catch (issue) { if (live) setError(issue instanceof Error ? issue.message : "Could not check availability."); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { live = false; window.clearInterval(timer); };
  }, [date, guests, selected, step, time]);
  const continueToTables = () => {
    if (!session) { setError("Sign in to your TableFlow account to continue."); return; }
    setError(""); setStep("tables");
  };
  const confirm = async () => {
    setBusy(true); setError("");
    try {
      await apiRequest<Reservation>("/reservations", { method: "POST", headers: { Authorization: `Bearer ${session?.accessToken ?? ""}` }, body: JSON.stringify({ restaurant_id: restaurantId, reservation_date: date, slot_start: time, guest_count: guests, guest_name: session?.user.full_name ?? "", guest_email: session?.user.email ?? "", preferred_table_id: selected }) });
      setStep("done");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not hold that table. Please try again."); }
    finally { setBusy(false); }
  };
  const selectedSlot = slots.find(slot => slot.value === time)?.label;
  const canConfirm = selected === null
    ? tables.some(table => table.available && table.fits_party)
    : tables.some(table => table.id === selected && table.available && table.fits_party);
  return <CustomerAuthRedirect><main className="tf-customer-page tf-reserve-page">
    <CustomerNav />
    <CustomerPageHero image="/images/tableflow-hero.png" eyebrow="An evening at TableFlow" title={step === "done" ? "Your evening is set." : "A table, made yours."} description={step === "done" ? "Your reservation has been recorded. We look forward to welcoming you." : "Tell us when you’re coming. We’ll find the right table for your evening."} className="tf-reserve-hero">
    {step === "done" ? <section className="tf-reserve-card tf-reserve-success"><span className="tf-reserve-check">✓</span><h2>Reservation confirmed</h2><p>{date} · {selectedSlot} · {guests} guests</p><div><Link href="/">Return home</Link><Link href="/menu">Explore the menu</Link></div></section> : <section className="tf-reserve-card">
      <div className="tf-reserve-steps"><span className={step === "details" ? "active" : "complete"}>01 <b>Your plans</b></span><span className={step === "tables" ? "active" : ""}>02 <b>Your table</b></span></div>
      {step === "details" ? <div className="tf-reserve-fields">
        <label>Date<input type="date" min={minDate || undefined} value={date} onChange={event => setSelectedDate(event.target.value)} /></label>
        <label>Arrival time<select value={time} onChange={event => setTime(event.target.value)}>{slots.map(slot => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select></label>
        <label>Guests<select value={guests} onChange={event => setGuests(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? "guest" : "guests"}</option>)}</select></label>
        <div className="tf-reserve-account"><span>Reserving as</span><strong>{session?.user.full_name}</strong><small>{session?.user.email}</small></div>
        {error && <p className="tf-route-error" role="alert">{error}</p>}
        <button className="tf-reserve-primary" onClick={continueToTables}>See available tables <span>→</span></button>
      </div> : <div className="tf-reserve-table-step"><div className="tf-reserve-summary"><strong>{date} · {selectedSlot}</strong><span>{guests} guests</span><button onClick={() => { setError(""); setStep("details"); }}>Edit plans</button></div>
        {tables.length ? <RestaurantFloor tables={tables} selectedTableId={selected} guestCount={guests} onSelectTable={setSelected} /> : <p className="tf-reserve-empty">No tables currently fit this party. Try another time or party size.</p>}
        {error && <p className="tf-route-error" role="alert">{error}</p>}
        <div className="tf-reserve-actions"><button className="tf-reserve-back" onClick={() => setStep("details")}>Back</button><button className="tf-reserve-primary" disabled={busy || !canConfirm} onClick={() => void confirm()}>{busy ? "Holding your table…" : selected ? "Confirm reservation" : "Let TableFlow choose"} <span>→</span></button></div>
      </div>}
    </section>}
    </CustomerPageHero>
  </main></CustomerAuthRedirect>;
}
