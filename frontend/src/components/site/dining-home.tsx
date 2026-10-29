"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowDownRight,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  MapPin,
  Menu,
  Minus,
  Phone,
  Plus,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiBaseUrl, apiRequest, restaurantId, fetchFloorAvailability } from "@/lib/api";
import type { TableFloorInfo } from "@/lib/api";
import { RestaurantFloor } from "@/components/site/restaurant-floor";

gsap.registerPlugin(ScrollTrigger);

type MenuDish = { id: number; name: string; detail: string; category: string; image: string; price_cents: number; available: boolean };
const originalMenu: MenuDish[] = [
  { id: 0, name: "Ember-roasted scallop", detail: "Brown butter · sea herbs · smoked leek", category: "Small plates", image: "/images/dish-scallop.png", price_cents: 2800, available: true },
  { id: -1, name: "Black garlic pappardelle", detail: "Wild mushroom · aged parmesan · pepper leaf", category: "Mains", image: "/images/dish-pasta.png", price_cents: 3200, available: true },
  { id: -2, name: "Pistachio mille-feuille", detail: "Lemon verbena · salted caramel · late berries", category: "Dessert", image: "/images/dish-dessert.png", price_cents: 1800, available: true },
];

const times = ["5:30 PM", "7:00 PM", "8:30 PM"];
const slotStarts: Record<string, string> = {
  "5:30 PM": "17:30:00",
  "7:00 PM": "19:00:00",
  "8:30 PM": "20:30:00",
};

function restaurantDateOffset(offset: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date = new Date(
    Date.UTC(
      Number(value("year")),
      Number(value("month")) - 1,
      Number(value("day")),
    ),
  );
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function subscribeToRestaurantDate(notify: () => void) {
  const timer = window.setInterval(notify, 60_000);
  return () => window.clearInterval(timer);
}

const getRestaurantToday = () => restaurantDateOffset(0);
const getRestaurantTomorrow = () => restaurantDateOffset(1);
const getServerToday = () => "";
const getServerReservationDate = () => "2026-10-16";

type ReservationResult = { id: number; table_number: string };
type AvailableTable = {
  id: number;
  number: string;
  capacity: number;
  location: string | null;
};
type CustomerSession = {
  accessToken: string;
  user: { id: number; email: string; full_name: string; role: string };
};
type AuthResponse = {
  access_token: string;
  user: CustomerSession["user"];
};
type AuthMode = "guest" | "sign-in" | "create-account";
type ReservationStep = "details" | "table";

const customerSessionKey = "tableflow.customer.session.v1";

function readStoredCustomerSession(): CustomerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(customerSessionKey);
    if (!stored) return null;
    const session = JSON.parse(stored) as CustomerSession;
    return session.accessToken && session.user?.email && session.user?.full_name
      ? session
      : null;
  } catch {
    return null;
  }
}

function formatReservationDate(value: string, short = false) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: short ? "short" : "long",
    day: "numeric",
    month: short ? "short" : "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function Monogram({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`monogram ${inverse ? "monogram--inverse" : ""}`}>TF</span>
  );
}

export function DiningHome() {
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const todayDate = useSyncExternalStore(
    subscribeToRestaurantDate,
    getRestaurantToday,
    getServerToday,
  );
  const defaultReservationDate = useSyncExternalStore(
    subscribeToRestaurantDate,
    getRestaurantTomorrow,
    getServerReservationDate,
  );
  const [selectedReservationDate, setSelectedReservationDate] =
    useState<string | null>(null);
  const reservationDate =
    selectedReservationDate && selectedReservationDate >= todayDate
      ? selectedReservationDate
      : defaultReservationDate;
  const [selectedTime, setSelectedTime] = useState("7:00 PM");
  const [guestCount, setGuestCount] = useState(2);
  const [activeCategory, setActiveCategory] = useState("All");
  const [menuItems, setMenuItems] = useState<MenuDish[]>(originalMenu);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const menu = await apiRequest<MenuDish[]>(`/menu?restaurant_id=${restaurantId}`); if (live) setMenuItems(menu); }
      catch { /* Keep the original showcase visible if API is temporarily unavailable. */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  const [reservationMade, setReservationMade] = useState(false);
  const [reservationStep, setReservationStep] =
    useState<ReservationStep>("details");
  const [customerSession, setCustomerSession] =
    useState<CustomerSession | null>(() => readStoredCustomerSession());
  const [guestName, setGuestName] = useState(
    () => customerSession?.user.full_name ?? "",
  );
  const [guestEmail, setGuestEmail] = useState(
    () => customerSession?.user.email ?? "",
  );
  const [assignedTable, setAssignedTable] = useState<string | null>(null);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableTables, setAvailableTables] = useState<AvailableTable[]>([]);
  const [floorTables, setFloorTables] = useState<TableFloorInfo[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [preferredTableId, setPreferredTableId] = useState<number | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("guest");
  const [authFullName, setAuthFullName] = useState(
    () => customerSession?.user.full_name ?? "",
  );
  const [authEmail, setAuthEmail] = useState(
    () => customerSession?.user.email ?? "",
  );
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .from(".site-header", { y: -20, opacity: 0, duration: 0.7 })
        .from(
          ".hero__copy > *",
          { y: 42, opacity: 0, duration: 0.9, stagger: 0.14 },
          "-=0.35",
        )
        .from(
          ".availability-card",
          { y: 30, opacity: 0, duration: 0.85 },
          "-=0.55",
        )
        .from(".hero__scroll-cue", { opacity: 0, duration: 0.5 }, "-=0.2");
      gsap.utils.toArray<HTMLElement>(".reveal-up").forEach((element) =>
        gsap.from(element, {
          y: 42,
          opacity: 0,
          duration: 0.95,
          ease: "power3.out",
          scrollTrigger: { trigger: element, start: "top 84%" },
        }),
      );
      gsap.utils.toArray<HTMLElement>(".image-mask").forEach((element) =>
        gsap.fromTo(
          element,
          { clipPath: "inset(0 0 100% 0)" },
          {
            clipPath: "inset(0 0 0% 0)",
            duration: 1.15,
            ease: "power4.inOut",
            scrollTrigger: { trigger: element, start: "top 80%" },
          },
        ),
      );
      gsap.to(".hero__image", {
        yPercent: 12,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, pageRef);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!sheetOpen || reservationMade || reservationStep !== "table") return;

    let current = true;
    const slotValue = slotStarts[selectedTime];

    const loadAvailability = async () => {
      await Promise.resolve();
      if (!current) return;
      setIsLoadingAvailability(true);
      setAvailabilityError(null);
      try {
        const floor = await fetchFloorAvailability(
          reservationDate,
          slotValue,
          guestCount,
        );
        if (!current) return;
        setFloorTables(floor);
        const available = floor.filter((t) => t.available && t.fits_party);
        setAvailableTables(
          available.map((t) => ({
            id: t.id,
            number: t.number,
            capacity: t.capacity,
            location: t.location,
          })),
        );
        setPreferredTableId((selected) =>
          selected && available.some((t) => t.id === selected)
            ? selected
            : null,
        );
      } catch (error) {
        if (!current) return;
        setFloorTables([]);
        setAvailableTables([]);
        setAvailabilityError(
          error instanceof Error
            ? error.message
            : "We could not check the room just now.",
        );
      } finally {
        if (current) setIsLoadingAvailability(false);
      }
    };
    void loadAvailability();

    // Poll every 10 seconds for fresh availability while floor plan is visible
    const pollId = setInterval(() => {
      if (!current) return;
      fetchFloorAvailability(reservationDate, slotValue, guestCount)
        .then((floor) => {
          if (!current) return;
          setFloorTables(floor);
          const available = floor.filter((t) => t.available && t.fits_party);
          setAvailableTables(
            available.map((t) => ({
              id: t.id,
              number: t.number,
              capacity: t.capacity,
              location: t.location,
            })),
          );
          setPreferredTableId((selected) =>
            selected && available.some((t) => t.id === selected)
              ? selected
              : null,
          );
        })
        .catch(() => { /* silent poll failure */ });
    }, 10_000);

    return () => {
      current = false;
      clearInterval(pollId);
    };
  }, [
    guestCount,
    reservationDate,
    reservationMade,
    reservationStep,
    selectedTime,
    sheetOpen,
  ]);

  const filteredItems =
    activeCategory === "All"
      ? menuItems.filter((item) => item.available)
      : menuItems.filter((item) => item.available && item.category === activeCategory);
  const reservationDateLabel = formatReservationDate(reservationDate);
  const shortReservationDateLabel = formatReservationDate(
    reservationDate,
    true,
  );
  const signOutCustomer = () => {
    window.sessionStorage.removeItem(customerSessionKey);
    setCustomerSession(null);
    setAuthMode("guest");
    window.dispatchEvent(new Event("tableflow-customer-session"));
  };
  const continueToTableSelection = () => {
    if (!customerSession) {
      setAuthMode("create-account");
      setAuthError("Create an account or sign in before reserving a table.");
      setReservationError(null);
      return;
    }
    if (!guestName.trim() || !guestEmail.trim()) {
      setReservationError(
        "Please share your name and email to continue to table selection.",
      );
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(guestEmail.trim())) {
      setReservationError("Please enter a valid email address.");
      return;
    }
    setReservationError(null);
    setReservationStep("table");
  };
  const authenticateCustomer = async () => {
    if (authMode === "guest") return;
    if (authMode === "create-account" && authFullName.trim().length < 2) {
      setAuthError("Please enter your full name.");
      return;
    }
    if (!authEmail.trim() || !authPassword) {
      setAuthError("Enter your email and password to continue.");
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const path =
        authMode === "create-account" ? "/auth/register" : "/auth/login";
      const body =
        authMode === "create-account"
          ? {
              full_name: authFullName.trim(),
              email: authEmail.trim(),
              password: authPassword,
            }
          : { email: authEmail.trim(), password: authPassword };
      const response = await apiRequest<AuthResponse>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (response.user.role !== "CUSTOMER") {
        throw new Error("Please sign in with a customer account to reserve a table.");
      }
      const session: CustomerSession = {
        accessToken: response.access_token,
        user: response.user,
      };
      window.sessionStorage.setItem(
        customerSessionKey,
        JSON.stringify(session),
      );
      window.dispatchEvent(new Event("tableflow-customer-session"));
      setCustomerSession(session);
      setGuestName(session.user.full_name);
      setGuestEmail(session.user.email);
      setAuthFullName(session.user.full_name);
      setAuthEmail(session.user.email);
      setAuthPassword("");
      setAuthMode("guest");
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "We could not sign you in.",
      );
    } finally {
      setIsAuthenticating(false);
    }
  };
  const confirmReservation = async () => {
    if (!guestName.trim() || !guestEmail.trim()) {
      setReservationError(
        "Please share your name and email to hold the table.",
      );
      return;
    }
    setIsSubmitting(true);
    setReservationError(null);
    try {
      const reservation = await apiRequest<ReservationResult>("/reservations", {
        method: "POST",
        body: JSON.stringify({
          restaurant_id: restaurantId,
          reservation_date: reservationDate,
          slot_start: slotStarts[selectedTime],
          guest_count: guestCount,
          guest_name: guestName.trim(),
          guest_email: guestEmail.trim(),
          preferred_table_id: preferredTableId,
        }),
        headers: customerSession
          ? { Authorization: `Bearer ${customerSession.accessToken}` }
          : undefined,
      });
      setAssignedTable(reservation.table_number);
      setReservationMade(true);
    } catch (error) {
      setReservationError(
        error instanceof Error
          ? error.message
          : "We could not hold that table.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      ref={pageRef}
      className={`dining-site ${sheetOpen ? "dining-site--sheet-open" : ""}`}
    >
      <section className="hero" id="experience">
        <Image
          className="hero__image"
          src="/images/tableflow-hero.png"
          alt="Candlelit TableFlow dining room"
          fill
          priority
          sizes="100vw"
        />
        <div className="hero__shade" />
        <header className="site-header shell">
          <a className="brand" href="#experience" aria-label="TableFlow home">
            <Monogram inverse />
            <span>TableFlow</span>
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="#experience">Home</a>
            <Link href="/menu">Menu</Link>
            <Link href="/reserve">Reservations</Link>
            <Link href="/orders">Track order</Link>
          </nav>
          <Link className="nav-reserve" href="/reserve">Reserve a table</Link>
          <button
            className="mobile-menu-button"
            aria-label="Open navigation"
            onClick={() => setMobileMenu(true)}
          >
            <Menu />
          </button>
        </header>
        <div className="shell hero__content">
          <div className="hero__copy">
            <p className="hero__kicker">An evening of intention</p>
            <h1>
              A table, timed
              <br />
              to perfection.
            </h1>
            <p className="hero__lede">
              TableFlow coordinates every arrival with the ease of true
              hospitality.
            </p>
            <Link className="gold-button" href="/reserve">
              Reserve a table <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <div
            className="availability-card"
            aria-label="Reservation availability"
          >
            <div className="availability-card__top">
              <span>Find your moment</span>
              <CalendarDays aria-hidden="true" />
            </div>
            <div className="booking-fields">
              <Link className="booking-field" href="/reserve">
                <span>Date</span>
                <strong>{shortReservationDateLabel}</strong>
                <ChevronDown />
              </Link>
              <Link className="booking-field" href="/reserve">
                <span>Guests</span>
                <strong>{guestCount}</strong>
                <ChevronDown />
              </Link>
            </div>
            <div className="time-label">One-hour arrival windows</div>
            <div className="time-options">
              {times.map((time) => (
                <button
                  key={time}
                  onClick={() => setSelectedTime(time)}
                  className={`time-option ${selectedTime === time ? "is-selected" : ""}`}
                >
                  <strong>{time}</strong>
                  <span>{time === "8:30 PM" ? "Limited" : "Available"}</span>
                </button>
              ))}
            </div>
            <Link href="/reserve" className="availability-continue">Choose a table <ArrowRight aria-hidden="true" /></Link>
          </div>
        </div>
        <a className="hero__scroll-cue" href="#story">
          Scroll to explore <ArrowDownRight aria-hidden="true" />
        </a>
      </section>

      <section id="story" className="story-section shell">
        <div className="story-copy reveal-up">
          <p className="section-mark">Our kitchen</p>
          <h2>
            The evening begins
            <br />
            before the first course.
          </h2>
          <p>
            Long before the room fills, seasonal ingredients and considered
            techniques begin to shape an experience designed to unfold at your
            pace.
          </p>
          <a href="#menu" className="text-link">
            Meet the menu <ArrowRight aria-hidden="true" />
          </a>
        </div>
        <div className="story-media image-mask">
          <Image
            src="/images/tableflow-chef.png"
            alt="Chef finishing a dish in the TableFlow kitchen"
            fill
            sizes="(max-width: 900px) 100vw, 42vw"
          />
        </div>
      </section>

      <section id="menu" className="menu-section">
        <div className="shell">
          <div className="menu-heading reveal-up">
            <div>
              <p className="section-mark">Seasonal menu</p>
              <h2>
                Made for the
                <br />
                unhurried table.
              </h2>
            </div>
            <p>
              Distinctive, seasonal dishes with one simple purpose: leave room
              for the conversation.
            </p>
          </div>
          <div className="menu-filter" aria-label="Menu categories">
            {["All", ...Array.from(new Set(menuItems.map((item) => item.category)))].map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={activeCategory === category ? "is-active" : ""}
              >
                {category}
              </button>
            ))}
          </div>
          <div className="dish-grid">
            {filteredItems.slice(0, 3).map((item, index) => (
              <article
                className={`dish-card reveal-up`}
                key={item.id}
                style={{ transitionDelay: `${index * 70}ms` }}
              >
                <div className="dish-card__media">
                  <Image
                    className="dish-card__photo"
                    src={item.image.startsWith("/api/v1/") ? `${apiBaseUrl.replace(/\/api\/v1$/, "")}${item.image}` : item.image}
                    unoptimized
                    alt={item.name}
                    fill
                    sizes="(max-width: 590px) 100vw, (max-width: 900px) 50vw, 33vw"
                  />
                  <span className="dish-card__count">0{index + 1}</span>
                </div>
                <div className="dish-card__body">
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.detail}</p>
                  </div>
                  <div className="dish-card__bottom">
                    <strong>${(item.price_cents / 100).toFixed(2)}</strong>
                    <button aria-label={`Order ${item.name}`} onClick={() => router.push(`/order?item=${item.id}`)}>
                      <ArrowRight />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <a className="tf-see-menu" href="/menu">View full menu →</a>
        </div>
      </section>

      <section id="reservations" className="reservation-section">
        <div className="reservation-image image-mask">
          <Image
            src="/images/tableflow-hero.png"
            alt="An intimate TableFlow dining setting"
            fill
            sizes="(max-width: 900px) 100vw, 50vw"
          />
        </div>
        <div className="reservation-panel">
          <div className="reservation-panel__inner reveal-up">
            <p className="section-mark">Reservations</p>
            <h2>
              Your table is
              <br />
              waiting.
            </h2>
            <p>
              Choose a one-hour arrival window, then let our team make the rest
              feel effortless.
            </p>
            <div className="stepper" aria-label="Reservation steps">
              <span className="is-current">
                1<small>Date</small>
              </span>
              <i />
              <span>
                2<small>Guests</small>
              </span>
              <i />
              <span>
                3<small>Time</small>
              </span>
              <i />
              <span>
                4<small>Table</small>
              </span>
            </div>
            <div className="reservation-preview">
              <div>
                <span>{reservationDateLabel}</span>
                <strong>
                  {guestCount} guests · {selectedTime}
                </strong>
              </div>
              <button
                onClick={() => setGuestCount((count) => Math.max(1, count - 1))}
                aria-label="Decrease guest count"
              >
                <Minus />
              </button>
              <button
                onClick={() =>
                  setGuestCount((count) => Math.min(12, count + 1))
                }
                aria-label="Increase guest count"
              >
                <Plus />
              </button>
            </div>
            <Link href="/reserve" className="gold-button reservation-cta">
              Start your reservation <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <section id="visit" className="visit-section shell">
        <div className="visit-intro reveal-up">
          <p className="section-mark">Find us</p>
          <h2>
            Come in from
            <br />
            the city.
          </h2>
          <p>
            A quieter corner, a warmer table. We are open for the moments that
            deserve the long way home.
          </p>
        </div>
        <div className="visit-details reveal-up">
          <div>
            <Clock3 />
            <span>Opening hours</span>
            <strong>
              Mon–Thu · 5:00–10:00
              <br />
              Fri–Sat · 5:00–11:00
              <br />
              Sun · 5:00–9:00
            </strong>
          </div>
          <div>
            <MapPin />
            <span>The Meridian</span>
            <strong>
              123 Kensington Road
              <br />
              London W8 5QY
            </strong>
            <a href="https://maps.google.com" target="_blank" rel="noreferrer">
              Get directions <ArrowRight />
            </a>
          </div>
          <div>
            <Phone />
            <span>Reservations</span>
            <strong>+44 20 7946 0123</strong>
            <a
              href="https://wa.me/442079460123"
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp <ArrowRight />
            </a>
          </div>
        </div>
      </section>
      <footer className="site-footer">
        <div className="shell">
          <div className="footer-brand">
            <Monogram inverse />
            <span>TableFlow</span>
          </div>
          <p>Thoughtful service, from the first click to the final pour.</p>
          <nav>
            <Link href="/reserve">Reservations</Link>
            <Link href="/menu">Menu</Link>
            <Link href="/order">Order</Link>
            <Link href="/orders">Track order</Link>
            <Link href="/host">Host desk</Link>
          </nav>
        </div>
      </footer>

      <AnimatePresence>
        {mobileMenu && (
          <motion.div
            className="mobile-nav"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              aria-label="Close navigation"
              onClick={() => setMobileMenu(false)}
            >
              <X />
            </button>
            <Monogram inverse />
            <a onClick={() => setMobileMenu(false)} href="#experience">
              Experience
            </a>
            <Link onClick={() => setMobileMenu(false)} href="/menu">
              Menu
            </Link>
            <Link onClick={() => setMobileMenu(false)} href="/reserve">
              Reservations
            </Link>
            <Link onClick={() => setMobileMenu(false)} href="/order">Order</Link>
            <Link onClick={() => setMobileMenu(false)} href="/orders">Track order</Link>
            <a onClick={() => setMobileMenu(false)} href="#visit">
              Visit
            </a>
            <Link className="gold-button" href="/reserve" onClick={() => setMobileMenu(false)}>
              Reserve a table <ArrowRight />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="reservation-sheet">
          <SheetHeader>
            <SheetTitle>
              {reservationMade ? "Your table is held." : "Reserve a table"}
            </SheetTitle>
            <SheetDescription>
              {reservationMade
                ? "Your reservation is recorded in TableFlow."
                : "Choose the moment. Select a table—or let us curate the best fit."}
            </SheetDescription>
          </SheetHeader>
          {reservationMade ? (
            <motion.div
              className="reservation-success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <span>
                <Check />
              </span>
              <h3>
                {reservationDateLabel}
                <br />
                {selectedTime}
              </h3>
              <p>
                {guestCount} guests · {assignedTable}
              </p>
              <button
                className="sheet-action"
                onClick={() => setSheetOpen(false)}
              >
                Done
              </button>
            </motion.div>
          ) : (
            <div
              className={`reservation-workflow reservation-workflow--${reservationStep}`}
            >
              <div className="reservation-flow-bar">
                <span>Reservation</span>
                <strong>
                  Step {reservationStep === "details" ? "1" : "2"} of 2
                </strong>
              </div>
              <ol
                className="reservation-progress"
                aria-label="Reservation progress"
              >
                <li
                  className={
                    reservationStep === "details" ? "active" : "complete"
                  }
                >
                  <span>1</span> Your plans
                </li>
                <li className={reservationStep === "table" ? "active" : ""}>
                  <span>2</span> Your table
                </li>
              </ol>
              <AnimatePresence mode="wait" initial={false}>
                {reservationStep === "details" ? (
                  <motion.div
                    key="details"
                    className="reservation-details"
                    initial={{ opacity: 0, x: -18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.32, ease: "easeOut" }}
                  >
                    <section className="sheet-form">
                      <div className="reservation-details__intro">
                        <span>Set the scene</span>
                        <strong>When shall we expect you?</strong>
                        <p>
                          Start with the essentials. We’ll reveal tables next.
                        </p>
                      </div>
                      <div className="booking-account">
                        {customerSession ? (
                          <>
                            <div>
                              <span>Dining as</span>
                              <strong>{customerSession.user.full_name}</strong>
                            </div>
                            <button type="button" onClick={signOutCustomer}>
                              Use another account
                            </button>
                          </>
                        ) : (
                          <>
                            <div>
                              <span>Account required</span>
                              <strong>
                                Sign in or create an account before choosing a table.
                              </strong>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setAuthError(null);
                                setAuthMode(authMode === "sign-in" ? "create-account" : "sign-in");
                              }}
                            >
                              {authMode === "sign-in" ? "Create account" : "Sign in"}
                            </button>
                          </>
                        )}
                      </div>
                      {authMode !== "guest" && !customerSession && (
                        <div className="reservation-auth">
                          <div
                            className="reservation-auth__tabs"
                            role="tablist"
                            aria-label="Account option"
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={authMode === "sign-in"}
                              className={
                                authMode === "sign-in" ? "selected" : ""
                              }
                              onClick={() => {
                                setAuthError(null);
                                setAuthMode("sign-in");
                              }}
                            >
                              Sign in
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={authMode === "create-account"}
                              className={
                                authMode === "create-account" ? "selected" : ""
                              }
                              onClick={() => {
                                setAuthError(null);
                                setAuthMode("create-account");
                              }}
                            >
                              Create account
                            </button>
                          </div>
                          {authMode === "create-account" && (
                            <label className="sheet-input">
                              <span>Full name</span>
                              <input
                                value={authFullName}
                                onChange={(event) =>
                                  setAuthFullName(event.target.value)
                                }
                                autoComplete="name"
                                placeholder="Your full name"
                              />
                            </label>
                          )}
                          <label className="sheet-input">
                            <span>Email</span>
                            <input
                              value={authEmail}
                              onChange={(event) =>
                                setAuthEmail(event.target.value)
                              }
                              autoComplete="email"
                              inputMode="email"
                              placeholder="you@example.com"
                              type="email"
                            />
                          </label>
                          <label className="sheet-input">
                            <span>Password</span>
                            <input
                              value={authPassword}
                              onChange={(event) =>
                                setAuthPassword(event.target.value)
                              }
                              autoComplete={
                                authMode === "create-account"
                                  ? "new-password"
                                  : "current-password"
                              }
                              placeholder={
                                authMode === "create-account"
                                  ? "At least 10 characters"
                                  : "Your password"
                              }
                              type="password"
                            />
                          </label>
                          {authError && (
                            <p className="reservation-error" role="alert">
                              {authError}
                            </p>
                          )}
                          <button
                            type="button"
                            className="auth-submit"
                            disabled={isAuthenticating}
                            onClick={authenticateCustomer}
                          >
                            {isAuthenticating
                              ? "One moment…"
                              : authMode === "create-account"
                                ? "Create account"
                                : "Sign in"}
                          </button>
                        </div>
                      )}
                      <div className="reservation-input-grid">
                        <label className="sheet-input">
                          <span>Date</span>
                          <input
                            type="date"
                            min={todayDate || undefined}
                            value={reservationDate}
                            onChange={(event) =>
                              setSelectedReservationDate(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          <span>Guests</span>
                          <div className="sheet-guests">
                            <button
                              type="button"
                              onClick={() =>
                                setGuestCount((count) => Math.max(1, count - 1))
                              }
                              aria-label="Decrease guests"
                            >
                              <Minus />
                            </button>
                            <strong>{guestCount} guests</strong>
                            <button
                              type="button"
                              onClick={() =>
                                setGuestCount((count) =>
                                  Math.min(12, count + 1),
                                )
                              }
                              aria-label="Increase guests"
                            >
                              <Plus />
                            </button>
                          </div>
                        </label>
                      </div>
                      <label>
                        <span>Arrival time</span>
                        <div className="sheet-times">
                          {times.map((time) => (
                            <button
                              type="button"
                              key={time}
                              onClick={() => setSelectedTime(time)}
                              className={
                                selectedTime === time ? "selected" : ""
                              }
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      </label>
                      <div className="reservation-input-grid">
                        <label className="sheet-input">
                          <span>Your name</span>
                          <input
                            value={guestName}
                            onChange={(event) =>
                              setGuestName(event.target.value)
                            }
                            autoComplete="name"
                            placeholder="Your full name"
                            readOnly={Boolean(customerSession)}
                          />
                        </label>
                        <label className="sheet-input">
                          <span>Email for confirmation</span>
                          <input
                            value={guestEmail}
                            onChange={(event) =>
                              setGuestEmail(event.target.value)
                            }
                            autoComplete="email"
                            inputMode="email"
                            placeholder="you@example.com"
                            type="email"
                            readOnly={Boolean(customerSession)}
                          />
                        </label>
                      </div>
                      {reservationError && (
                        <p className="reservation-error" role="alert">
                          {reservationError}
                        </p>
                      )}
                      <button
                        className="sheet-action"
                        type="button"
                        onClick={continueToTableSelection}
                      >
                        See available tables <ArrowRight />
                      </button>
                    </section>
                    <aside
                      className="reservation-atmosphere"
                      aria-hidden="true"
                    >
                      <div>
                        <span>TableFlow evening</span>
                        <strong>Your table is held for one hour.</strong>
                      </div>
                    </aside>
                  </motion.div>
                ) : (
                  <motion.div
                    key="table"
                    className="reservation-table-stage"
                    initial={{ opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.32, ease: "easeOut" }}
                  >
                    <section
                      className="table-choice table-choice--available"
                      aria-live="polite"
                      aria-busy={isLoadingAvailability}
                    >
                      <div className="table-choice__heading">
                        <span>Your setting</span>
                        <strong>Choose your table</strong>
                        <p>
                          Live availability for your exact party and arrival
                          window.
                        </p>
                      </div>
                      <div className="reservation-summary">
                        <span>
                          {reservationDateLabel} · {selectedTime}
                        </span>
                        <strong>{guestCount} guests</strong>
                        <button
                          type="button"
                          onClick={() => setReservationStep("details")}
                        >
                          Edit plans
                        </button>
                      </div>
                      {isLoadingAvailability ? (
                        <p className="table-choice__status">
                          Checking the room…
                        </p>
                      ) : availabilityError ? (
                        <p className="reservation-error">
                          We couldn’t refresh the table list. You can still ask
                          TableFlow to find the best fit.
                        </p>
                      ) : floorTables.length === 0 ? (
                        <p className="table-choice__status">
                          No tables are open for this moment. Try another time
                          or party size.
                        </p>
                      ) : (
                        <RestaurantFloor
                          tables={floorTables}
                          selectedTableId={preferredTableId}
                          guestCount={guestCount}
                          onSelectTable={(id) => {
                            setPreferredTableId(id);
                            setReservationError(null);
                          }}
                        />
                      )}
                      <div className="table-choice__footer">
                        {reservationError && (
                          <p className="reservation-error" role="alert">
                            {reservationError}
                          </p>
                        )}
                        <div className="reservation-table-actions">
                          <button
                            type="button"
                            className="reservation-back"
                            onClick={() => setReservationStep("details")}
                          >
                            Back
                          </button>
                          <button
                            className="sheet-action"
                            disabled={
                              isSubmitting ||
                              isLoadingAvailability ||
                              (!availabilityError &&
                                availableTables.length === 0)
                            }
                            onClick={confirmReservation}
                          >
                            {isSubmitting
                              ? "Holding your table…"
                              : preferredTableId
                                ? `Confirm ${availableTables.find((table) => table.id === preferredTableId)?.number ?? "table"}`
                                : "Confirm reservation"}{" "}
                            <ArrowRight />
                          </button>
                        </div>
                      </div>
                    </section>
                    <aside className="reservation-notes">
                      <span>Thoughtful by design</span>
                      <p>
                        Every listed table has space for your party and is
                        verified against the live floor.
                      </p>
                    </aside>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
