# TableFlow architecture

```text
Next.js App Router ── REST /api/v1 ── FastAPI routers ── services ── SQLAlchemy/PostgreSQL
       │                                       │
       └── client interaction state             └── WebSocket event hub for table/queue changes
```

The initial delivery is a single-branch modular monolith. PostgreSQL is the authority for availability and seating; the frontend may display seeded UI while the backend is not configured, but it does not treat browser state as durable truth.

### Main state transitions

| Area | States | Guard |
| --- | --- | --- |
| Table | AVAILABLE, RESERVED, OCCUPIED, UNAVAILABLE | capacity and physical workflow validation |
| Reservation | CONFIRMED, CHECKED_IN, CANCELLED | one-hour slot conflict constraint + row lock |
| Queue | WAITING, CALLED, SEATED, CANCELLED | FIFO among capacity-compatible active entries |
