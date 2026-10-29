"use client";

import { useCallback, useEffect, useState } from "react";
import { apiBaseUrl, apiRequest, restaurantId } from "@/lib/api";

type Dish = { id: number; name: string; detail: string; category: string; image: string; price_cents: number; available: boolean };
type Table = { id: number; number: string };

export function MenuManager({ token }: { token: string }) {
  const [items, setItems] = useState<Dish[]>([]);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState("Mains");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const auth = { Authorization: `Bearer ${token}` };
  const load = useCallback(async () => {
    try {
      setItems(await apiRequest<Dish[]>(`/menu?restaurant_id=${restaurantId}`));
    } catch (err) { setError(err instanceof Error ? err.message : "Cannot load menu"); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(""); setMessage(""); setSaving(true);
    try {
      let chosenImage = "/images/dish-pasta.png";
      if (photo) {
        if (photo.size > 4_000_000) throw new Error("Photo must be smaller than 4 MB");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Could not read photo"));
          reader.readAsDataURL(photo);
        });
        const uploaded = await apiRequest<{ image: string }>("/menu/photos", { method: "POST", headers: auth, body: JSON.stringify({ filename: photo.name, data }) });
        chosenImage = uploaded.image;
      }
      await apiRequest("/menu", { method: "POST", headers: auth, body: JSON.stringify({ restaurant_id: restaurantId, name, detail, category, image: chosenImage, price_cents: Math.round(Number(price) * 100) }) });
      setName(""); setDetail(""); setPrice(""); setPhoto(null); setMessage("Dish added to customer website."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to add dish"); }
    finally { setSaving(false); }
  };
  const patch = async (id: number, values: Partial<Dish>) => {
    try { await apiRequest(`/menu/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify(values) }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Update failed"); }
  };
  const remove = async (id: number) => {
    if (!window.confirm("Delete this dish from the menu? Existing orders will keep their saved details.")) return;
    try { await apiRequest(`/menu/${id}`, { method: "DELETE", headers: auth }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
  };
  const qrUrl = `${apiBaseUrl}/menu/qr?restaurant_id=${restaurantId}`;
  return <section className="host-task-panel tf-menu-manager">
    <div className="host-task-heading"><p>Host controls</p><h2>Menu & QR codes</h2><span>Only host, manager and admin accounts may change menu items. Customer pages update automatically.</span></div>
    {error && <p role="alert" className="food-order-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <form onSubmit={create} className="tf-menu-form">
      <label>Dish name<input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="New dish name" /></label>
      <label>Description<input value={detail} onChange={e => setDetail(e.target.value)} placeholder="Ingredients or details" /></label>
      <label>Category<select required value={category} onChange={e => setCategory(e.target.value)}><option>Mains</option><option>Starters</option><option>Sides</option><option>Beverages</option><option>Desserts</option><option>Specials</option></select><small>Choose a section so customers can browse easily.</small></label>
      <label>Price ($)<input required type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label className="tf-photo-upload"><span>Dish photo</span><span className="tf-photo-upload-surface"><span className="tf-upload-symbol">↑</span><strong>{photo ? photo.name : "Choose photo from computer"}</strong><small>JPG, PNG, WebP or GIF · maximum 4 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const file = e.target.files?.[0] || null; setPhoto(file); }} /></label>
      <button className="tf-add-dish-button" disabled={saving} type="submit">{saving ? "Adding…" : "+ Add menu item"}</button>
    </form>
    <h3>Existing dishes</h3>
    <div className="tf-menu-items">{items.map(item => <div className="tf-menu-item" key={item.id}><div><strong>{item.name}</strong><small>{item.category} · ${(item.price_cents/100).toFixed(2)}</small></div><div><button onClick={() => void patch(item.id, { available: !item.available })}>{item.available ? "Hide" : "Show"}</button><button onClick={() => { const name = window.prompt("Dish name", item.name); if (name !== null) void patch(item.id, { name }); }}>Rename</button><button onClick={() => { const v = window.prompt("New price ($)", (item.price_cents / 100).toFixed(2)); if (v && Number(v) > 0) void patch(item.id, { price_cents: Math.round(Number(v) * 100) }); }}>Change price</button><button onClick={() => void remove(item.id)}>Delete</button></div></div>)}</div>
    <h3>QR ordering</h3><p>One common QR code opens the beautiful full menu with all available dishes. Customers select their order type and available table when ordering.</p>
    {/* QR is generated on our backend, not by a third-party QR website. */}
    <div className="tf-qr"><img key={qrUrl} src={qrUrl} width={210} height={210} alt="Customer ordering QR code" /><a href={qrUrl} download={`tableflow-menu-qr.svg`} target="_blank" rel="noreferrer">Open / save QR image ↗</a></div>
    <p className="tf-qr-hint">For phone scanning, set PUBLIC_CUSTOMER_URL to the customer website address accessible from your phone (localhost works only on the same computer).</p>
  </section>;
}
