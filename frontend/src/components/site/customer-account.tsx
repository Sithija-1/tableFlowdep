"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";

const CUSTOMER_SESSION_KEY = "tableflow.customer.session.v1";
let currentSession: CustomerSession | null = null;
let accountReady = false;
const accountListeners = new Set<() => void>();

export type CustomerSession = {
  accessToken: string;
  user: { id: number; email: string; full_name: string; phone: string | null; role: string };
};
type AuthResponse = { access_token: string; user: CustomerSession["user"] };
type AccountContextValue = {
  session: CustomerSession | null;
  ready: boolean;
  authenticate: (mode: "sign-in" | "create-account", data: { name?: string; phone?: string; email: string; password: string }) => Promise<void>;
  signOut: () => void;
};
const AccountContext = createContext<AccountContextValue | null>(null);

function readSession(): CustomerSession | null {
  try {
    const value = sessionStorage.getItem(CUSTOMER_SESSION_KEY);
    if (!value) return null;
    const session = JSON.parse(value) as CustomerSession;
    return session.accessToken && session.user?.role === "CUSTOMER" ? session : null;
  } catch {
    return null;
  }
}

function refreshAccountStore() {
  currentSession = readSession();
  accountReady = true;
  accountListeners.forEach(listener => listener());
}
function subscribeAccount(listener: () => void) {
  accountListeners.add(listener);
  window.addEventListener("tableflow-customer-session", refreshAccountStore);
  refreshAccountStore();
  return () => {
    accountListeners.delete(listener);
    window.removeEventListener("tableflow-customer-session", refreshAccountStore);
  };
}

export function CustomerAccountProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeAccount, () => currentSession, () => null);
  const ready = useSyncExternalStore(subscribeAccount, () => accountReady, () => false);

  const authenticate: AccountContextValue["authenticate"] = async (mode, data) => {
    const path = mode === "create-account" ? "/auth/register" : "/auth/login";
    const payload = mode === "create-account"
      ? { full_name: data.name?.trim() ?? "", phone: data.phone?.trim() ?? "", email: data.email.trim(), password: data.password }
      : { email: data.email.trim(), password: data.password };
    const response = await apiRequest<AuthResponse>(path, { method: "POST", body: JSON.stringify(payload) });
    if (response.user.role !== "CUSTOMER") throw new Error("Please use a customer account to continue.");
    const next = { accessToken: response.access_token, user: response.user };
    sessionStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(next));
    refreshAccountStore();
  };

  const signOut = () => {
    sessionStorage.removeItem(CUSTOMER_SESSION_KEY);
    refreshAccountStore();
  };

  return <AccountContext.Provider value={{ session, ready, authenticate, signOut }}>{children}</AccountContext.Provider>;
}

export function useCustomerAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useCustomerAccount must be used inside CustomerAccountProvider");
  return value;
}

export function CustomerAuthRedirect({ children }: { children: ReactNode }) {
  const { session, ready } = useCustomerAccount();
  const router = useRouter();
  useEffect(() => {
    if (ready && !session) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/account/sign-in?next=${encodeURIComponent(next)}`);
    }
  }, [ready, router, session]);
  return session ? <>{children}</> : <main className="tf-customer-page tf-auth-redirect" aria-live="polite">Taking you to sign in…</main>;
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/order";
  return value;
}

export function CustomerAuthPage({ mode }: { mode: "sign-in" | "create-account" }) {
  const { session, ready, authenticate } = useCustomerAccount();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!ready || !session) return;
    router.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
  }, [ready, router, session]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authenticate(mode, { name, phone, email, password });
      router.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not sign you in."); }
    finally { setBusy(false); }
  };

  return (
    <main className="tf-customer-page tf-account-page tf-auth-page">
      <section className="tf-auth-panel" aria-labelledby="tf-auth-title">
        <Link className="tf-auth-brand" href="/">TABLEFLOW</Link>
        <p className="section-mark">YOUR TABLEFLOW ACCOUNT</p>
        <h1 id="tf-auth-title">{mode === "create-account" ? "Make room for something good." : "Welcome back."}</h1>
        <p className="tf-auth-description">{mode === "create-account" ? "Create your account to reserve, order, and follow every delivery." : "Sign in to continue with your TableFlow order or reservation."}</p>
        <form className="tf-account-form" onSubmit={submit}>
          {mode === "create-account" && <>
            <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></label>
            <label>Phone number<input required type="tel" minLength={7} maxLength={32} autoComplete="tel" pattern="[+]?[0-9][0-9 () .-]{5,30}" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+94 77 123 4567" /></label>
          </>}
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input required minLength={mode === "create-account" ? 10 : 1} type="password" autoComplete={mode === "create-account" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === "create-account" ? "At least 10 characters" : "Your password"} /></label>
          {error && <p className="tf-account-error" role="alert">{error}</p>}
          <button className="tf-account-submit" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "create-account" ? "Create account" : "Sign in"}<span aria-hidden="true">→</span></button>
        </form>
        <p className="tf-auth-switch">{mode === "create-account" ? "Already have an account?" : "New to TableFlow?"} <Link href={`/account/${mode === "create-account" ? "sign-in" : "sign-up"}`} onClick={event => { event.preventDefault(); router.push(`/account/${mode === "create-account" ? "sign-in" : "sign-up"}${window.location.search}`); }}>{mode === "create-account" ? "Sign in" : "Create an account"}</Link></p>
      </section>
    </main>
  );
}
