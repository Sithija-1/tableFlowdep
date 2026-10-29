"use client";

import { useEffect, useRef, useState } from "react";

const WS_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1")
    .replace(/^http/, "ws")
    .replace(/\/$/, "");

const MAX_BACKOFF_MS = 30_000;

export type RealtimeEvent = {
  type: string;
  table_id?: number;
  status?: string;
  reservation_id?: number;
  queue_entry_id?: number;
};

/**
 * Hook that opens a WebSocket to the TableFlow real-time event hub.
 * Reconnects with exponential backoff on disconnection.
 * Returns { connected } state and calls `onEvent` for each incoming message.
 */
export function useRealtime(
  restaurantId: number,
  accessToken: string | null,
  onEvent: (event: RealtimeEvent) => void,
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1_000);
  const onEventRef = useRef(onEvent);
  const connectRef = useRef<() => void>(() => {});

  // Keep the onEvent callback ref in sync without reading during render
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!accessToken) return;

    let disposed = false;

    const attemptConnect = () => {
      if (disposed) return;
      const url = `${WS_BASE}/realtime/restaurants/${restaurantId}?access_token=${accessToken}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoffRef.current = 1_000;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          onEventRef.current(data);
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (disposed) return;
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        setTimeout(attemptConnect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectRef.current = attemptConnect;
    attemptConnect();

    return () => {
      disposed = true;
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, [restaurantId, accessToken]);

  return { connected };
}
