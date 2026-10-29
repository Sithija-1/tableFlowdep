# Decisions

## 2026-10-10 — Proposal availability

`docs/TableFlow-Proposal.odt` was not present in the workspace when work started. The supplied TableFlow brief is therefore the current product authority. Its mandatory PostgreSQL requirement takes precedence over the earlier local MySQL note.

## 2026-10-10 — Database configuration

The backend uses PostgreSQL through a `DATABASE_URL` environment variable. Real local credentials are intentionally not written into tracked files. Development can use Docker Compose or a locally configured PostgreSQL service.

## 2026-10-10 — Reservation time model

The initial release models a reservation as one exact one-hour slot (`reservation_date` plus `slot_start`). A database uniqueness constraint and `SELECT … FOR UPDATE` table lock jointly prevent two confirmations for the same table and slot.

## 2026-10-10 — Queue policy

Queue ordering is deterministic: earliest active arrival first, filtered by party size and then assigned to the smallest currently AVAILABLE eligible table. Assignment writes the table state, queue state and seating record in a single transaction.
