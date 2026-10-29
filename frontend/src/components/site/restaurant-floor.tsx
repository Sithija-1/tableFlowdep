"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import type { TableFloorInfo } from "@/lib/api";

const positionClass: Record<string, string> = {
  T01: "customer-table--1",
  T02: "customer-table--2",
  T03: "customer-table--3",
  T04: "customer-table--4",
  T05: "customer-table--5",
  T06: "customer-table--6",
  T07: "customer-table--7",
  T08: "customer-table--8",
  T09: "customer-table--9",
  T10: "customer-table--10",
};

function statusClass(table: TableFloorInfo): string {
  // Slot-specific: status is AVAILABLE or RESERVED for the chosen date/time
  if (!table.fits_party) return "customer-table--small";
  if (table.status === "RESERVED") return "customer-table--reserved";
  if (table.available) return "customer-table--available";
  return "customer-table--booked";
}

function statusLabel(table: TableFloorInfo): string {
  if (!table.fits_party) return `Seats ${table.capacity}`;
  if (table.status === "RESERVED") return "Reserved";
  if (table.available) return "Available";
  return "Unavailable";
}

function tooltipText(table: TableFloorInfo, guestCount: number): string {
  const loc = table.location ?? "Dining room";
  if (!table.fits_party) {
    return `Seats ${table.capacity} — Your party needs ${guestCount}`;
  }
  if (table.status === "RESERVED") {
    return `${loc} · Already booked for this date & time`;
  }
  if (table.available) {
    return `${loc} · Seats ${table.capacity} — Click to select`;
  }
  return `${loc} · Not available for this time`;
}

export function RestaurantFloor({
  tables,
  selectedTableId,
  guestCount,
  onSelectTable,
}: {
  tables: TableFloorInfo[];
  selectedTableId: number | null;
  guestCount: number;
  onSelectTable: (tableId: number | null) => void;
}) {
  return (
    <div className="customer-floor" role="group" aria-label="Restaurant floor plan">
      {/* Auto-assign option */}
      <button
        type="button"
        className={`floor-auto-option ${selectedTableId === null ? "selected" : ""}`}
        onClick={() => onSelectTable(null)}
        aria-pressed={selectedTableId === null}
      >
        <span>
          <b>Let TableFlow choose</b>
          <small>Best fit for your party</small>
        </span>
        {selectedTableId === null ? (
          <Check aria-hidden="true" />
        ) : (
          <small style={{ color: "#806029", fontWeight: 700, fontSize: 9, letterSpacing: "0.09em", textTransform: "uppercase" as const }}>Auto</small>
        )}
      </button>

      {/* Floor header with legend */}
      <div className="customer-floor-header">
        <span>Live floor · {tables.filter((t) => t.available).length} available</span>
        <div className="customer-floor-legend">
          <span>
            <i className="avail" />
            Available
          </span>
          <span>
            <i className="reserved-dot" />
            Reserved
          </span>
        </div>
      </div>

      {/* Floor map */}
      <div
        className="customer-floor-map"
        aria-label="Interactive floor plan — select an available table"
      >
        {/* Ambient window light effect */}
        <div className="customer-floor-ambient" aria-hidden="true" />

        {/* Zone labels */}
        <span className="customer-floor-zone customer-floor-zone--window" aria-hidden="true">
          Window seating
        </span>
        <span className="customer-floor-zone customer-floor-zone--main" aria-hidden="true">
          Main dining
        </span>
        <span className="customer-floor-zone customer-floor-zone--terrace" aria-hidden="true">
          Terrace
        </span>
        <span className="customer-floor-zone customer-floor-zone--entrance" aria-hidden="true">
          Entrance
        </span>
        <span className="customer-floor-zone customer-floor-zone--kitchen" aria-hidden="true">
          Kitchen
        </span>

        {/* Decorative aisles */}
        <span className="customer-floor-aisle customer-floor-aisle--h" aria-hidden="true" />
        <span className="customer-floor-aisle customer-floor-aisle--v" aria-hidden="true" />

        {/* Tables */}
        {tables.map((table, index) => {
          const isAvailable = table.available && table.fits_party;
          const isSelected = selectedTableId === table.id;

          return (
            <motion.button
              key={table.id}
              type="button"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: index * 0.04,
                duration: 0.35,
                ease: "easeOut",
              }}
              disabled={!isAvailable}
              onClick={() => isAvailable && onSelectTable(table.id)}
              className={[
                "customer-table",
                table.shape,
                positionClass[table.number] ?? "",
                statusClass(table),
                isSelected ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={`${table.number}, ${table.capacity} seats, ${table.location ?? "Dining room"}, ${statusLabel(table)}`}
              aria-pressed={isSelected}
            >
              <strong>{table.number}</strong>
              <span>{table.capacity} seats</span>
              <em>{statusLabel(table)}</em>
              <span className="customer-table-tip" role="tooltip">
                {tooltipText(table, guestCount)}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
