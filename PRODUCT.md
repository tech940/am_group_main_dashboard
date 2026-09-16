# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Group leadership** (MD, EA, CEO) of AM Group, a multi-brand automotive dealership group in Jammu & Kashmir
  (AM Kia, AM Hyundai, AM Platinum, AM MG, and display-only brands). They review money, approvals and
  exceptions across branches, usually in short sessions between other work.
- **Branch and department staff** (sales, service, finance, HR, accounts) who raise requests, record work and
  follow their own queues. Access is per user and per section, set in the Admin Access Map.
- **Fuel Management** specifically is opened by EA, MD and Developer, plus anyone individually ticked in the
  Access Map (owner decision, 2026-09-11, reconfirmed 2026-09-16). Its design is management-first.

## Product Purpose

An internal operations dashboard that turns the group's dealer-management-system feeds and its own workflows
(bookings, proformas, approvals, petty cash, purchase orders, demo car gate passes, fuel requests) into one place
to act from. Success means a manager can see what happened, why, who is involved, whether something is wrong,
and what needs doing — without leaving the screen or reconciling spreadsheets by hand.

## Positioning

It joins the group's own records to each other: a fuel request to the demo car's gate pass, to the pump-meter
photo, to the GPS trip. No off-the-shelf fleet or DMS product holds all of those.

## Operating Context

- Feeds are cumulative daily snapshots re-uploaded from the DMS; most must be deduplicated to one canonical row.
- Demo cars leave and return through a QR-verified gate pass with odometer readings and photos; about a third of
  the demo fleet has a LocoNav GPS tracker, linked to the car by VIN by a person, never by plate.
- Fuel is requested through Fuel Approvals (the CEO's approval is final), then finalised with the bill.
- Owner decisions (2026-09-16): a fuel request carries **requested, approved and actual** litres; a demo car's
  "Fuel filling" gate pass is linked to its request by staff picking it on the request.
- Email is the only notification channel; the in-app notification system was removed on 2026-07-14.

## Capabilities and Constraints

- Next.js 16 App Router, Drizzle, Supabase Postgres, Redis caching; deployed on Vercel.
- There is no middleware: every page and API route guards itself, and the sidebar, search and page must apply
  the same rule.
- Migrations are applied by hand on the direct session port, never through the pooler.
- Customer phone and email are visible to MD and Super Admin only.
- The LocoNav account provides GPS positions, movement status, trips and distance. It provides **no fuel-level or
  fuel-sensor data**.
- Undecided: department-level fuel analysis has no historical data; the using department is captured from
  2026-09-16 onward.

## Brand Commitments

- The colour scheme is locked: slate neutrals, indigo accent, white surfaces, deep navy sidebar. Redesigns change
  structure, layout, hierarchy and behaviour, not the palette. The Admin Console is the one sanctioned exception.
- The sidebar keeps its card-accordion design.

## Evidence on Hand

- Live data only. As of 2026-09-16: 44 fuel requests (41 approved, 1 finalised with a bill), 59 demo gate
  passes, 13 GPS-reconciled trips (463 km).
- Never invent prices, costs, mileage bands or benchmarks. A figure the data cannot support is shown as
  missing, with the reason.

## Product Principles

1. Show the source of every number, and say when there is not enough data instead of estimating silently.
2. Flag what looks unusual in neutral terms; the system supports investigation, it does not accuse anyone.
3. One rule, stated once, applied everywhere a person can reach the same thing.
4. Keep what already works; change it only for a stated reason.

## Accessibility & Inclusion

WCAG AA: visible keyboard focus, labelled controls, table headers with scope, and status never conveyed by
colour alone.
