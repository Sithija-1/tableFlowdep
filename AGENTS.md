# TableFlow contributor guide

## Structure

- `frontend/` is the Next.js App Router experience. Keep customer-facing editorial work separate from the compact host-desk UI.
- `backend/` is a FastAPI modular monolith: routers coordinate HTTP, services own workflows, models map persistence, and schemas define public contracts.
- `docs/` records architecture and product decisions.

## Working agreements

- Never commit `.env` files, passwords, tokens, or real guest data. Update `.env.example` instead.
- A table's physical status is not its future reservation availability. Availability always considers capacity, status, date and one-hour slot.
- Reservation confirmation and queue seating must be transactional and lock candidate table records before changing assignment state.
- Enforce roles in the backend. Hiding a frontend route is not authorization.
- Run the smallest relevant lint/test/build check before committing. Use Webpack mode for the current Next build because Turbopack workers cannot bind in this environment.

## Design system

- Public palette: charcoal, warm ivory, champagne gold, deep olive, restrained terracotta.
- Operational UI favors dense clarity over animation. Do not introduce unapproved dashboard metric cards or decorative badges.
- Preserve reduced-motion support whenever adding motion.
