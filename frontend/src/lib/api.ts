const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

export const apiBaseUrl = configuredApiUrl ?? "http://127.0.0.1:8000/api/v1";
export const restaurantId = Number(
  process.env.NEXT_PUBLIC_RESTAURANT_ID ?? "1",
);

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiErrorPayload = {
  detail?: unknown;
  message?: unknown;
};

function humanizeField(value: unknown) {
  if (typeof value !== "string") return null;
  return value.replace(/_/g, " ");
}

function formatValidationMessage(field: string | null, message: string) {
  const normalized = message.toLowerCase();
  if (field === "email" && normalized.includes("email")) {
    return "Enter a valid email address.";
  }
  if (field === "password" && normalized.includes("at least 10")) {
    return "Password must be at least 10 characters.";
  }
  if (field === "full name" && normalized.includes("at least 2")) {
    return "Full name must be at least 2 characters.";
  }
  return field ? `${field}: ${message}` : message;
}

function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail.trim();

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => formatApiErrorDetail(item))
      .filter((message): message is string => Boolean(message));
    return messages.length ? messages.join(" ") : null;
  }

  if (!detail || typeof detail !== "object") return null;

  const record = detail as Record<string, unknown>;
  const message =
    (typeof record.msg === "string" && record.msg) ||
    (typeof record.message === "string" && record.message) ||
    formatApiErrorDetail(record.detail);
  if (!message) return null;

  const location = Array.isArray(record.loc)
    ? record.loc
        .map(humanizeField)
        .filter((value): value is string => Boolean(value))
    : [];
  const field = location.length ? location[location.length - 1] : null;
  return formatValidationMessage(field, message);
}

function formatApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const errorPayload = payload as ApiErrorPayload;
  return (
    formatApiErrorDetail(errorPayload.detail) ||
    formatApiErrorDetail(errorPayload.message) ||
    fallback
  );
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError(
      "TableFlow is temporarily unavailable. Please try again shortly.",
      0,
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw new ApiError(
      formatApiError(payload, "We could not complete that request."),
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/* ── Floor plan availability ── */

export type TableFloorInfo = {
  id: number;
  number: string;
  capacity: number;
  location: string | null;
  shape: "round" | "wide";
  status: "AVAILABLE" | "RESERVED" | "OCCUPIED" | "UNAVAILABLE";
  available: boolean;
  fits_party: boolean;
};

export function fetchFloorAvailability(
  reservationDate: string,
  slotStart: string,
  guestCount: number,
): Promise<TableFloorInfo[]> {
  const params = new URLSearchParams({
    restaurant_id: String(restaurantId),
    reservation_date: reservationDate,
    slot_start: slotStart,
    guest_count: String(guestCount),
  });
  return apiRequest<TableFloorInfo[]>(`/tables/floor?${params}`);
}
