# Defense Trackers

**Open, verifiable trackers for the defense innovation ecosystem.**
Public datasets that say exactly how fresh they are — append-only, hash-chained, and reproducible from public sources.

### → [defense-trackers.github.io](https://defense-trackers.github.io/)

[![site](https://img.shields.io/badge/site-live-35d07f)](https://defense-trackers.github.io/)
[![data](https://img.shields.io/badge/data-CC--BY--4.0-5eb1ff)](LICENSE)
[![build](https://img.shields.io/badge/build-none%20·%20static-8b97a8)](#how-its-built)
[![changelog](https://img.shields.io/badge/changelog-hash--chained-e3b341)](#verify-it-yourself)

---

## What this is

A growing set of trackers that consolidate scattered, rarely-aggregated information across the defense innovation ecosystem — solicitations, policy taskings, authorizations, cleared lists, and more — into clean datasets with a **tamper-evident change history**.

Nothing here is non-public. The value is consolidation, honesty about freshness, and a changelog you can cryptographically verify.

## The trackers

The live board always shows current status and freshness. See **[the homepage](https://defense-trackers.github.io/)** for what's published right now.

| # | Tracker | What it consolidates |
|---|---|---|
| T1 | Opportunity Pipeline | DIU CSOs, SBIR/STTR topics, BAAs, xTech/AFWERX — one normalized feed |
| T2 | Policy & Taskings | DoD AI issuances and their embedded deadline clocks |
| T3 | AI Authorizations | FedRAMP / DoD IL authorization status and changes |
| T4 | "What Can I Use" | Which AI tools each service can touch on NIPR, at what data ceiling |
| T5 | TAK Ecosystem | Live plugin index with liveness and SDK compatibility |
| T6 | Blue UAS | DIU/DCMA cleared list churn + NDAA-compliant components |
| T7 | Open-Weight Model Ops | License × VRAM fit × day-0 stack support, gov-deployability |
| T8 | DoD OSS Index | Health-scored index of maintained government open source |
| T9 | Transition Scoreboard | Whether prototypes ever reach production |
| T10 | Innovation Deadlines | CFPs, challenges, and events in one calendar (iCal) |

## How to use the data — the JSON *is* the API

No keys, no SDK. Just fetch the files:

```
data/<tracker>/current.json        # live state — one record per row
data/<tracker>/events/<year>.jsonl # append-only, hash-chained changelog
data/status.json                   # per-source freshness and state
feeds/<tracker>.xml                # RSS of changes
```

Every tracker has an RSS feed — subscribe and you get a notification the moment something changes.

## Freshness is stated, never assumed

Each source carries a state and a last-success timestamp, rendered as a signal light:

- **fresh** — updated within its cadence
- **lagging** — overdue; last-good data still shown, clearly marked
- **stale / degraded** — collection is failing; not current

A failed fetch never overwrites good data with garbage — a validation gate quarantines suspicious batches instead of publishing them.

## Verify it yourself

The changelog is append-only and hash-chained: each event records the SHA-256 of the previous one, so any edit to history is detectable. Re-derive the chain from the public data with the engine:

```
engine verify --out .
```

## How it's built

Static site, **no build step, no dependencies, no telemetry** — hand-written HTML, vanilla ES modules, one stylesheet, system fonts only. The data is produced by a separate Go engine on a schedule and committed here. The design goal is graceful abandonment: if untouched, the site decays into a correctly-dated archive — never a zombie serving stale data as fresh.

## Corrections & contributions

See something wrong or stale? **[Open an issue](https://github.com/defense-trackers/defense-trackers.github.io/issues)** — corrections are welcome and tracked.

## License & citation

Data is **[CC-BY-4.0](LICENSE)** (attribution keeps the canonical source canonical). Site code is MIT. Cite via [CITATION.cff](CITATION.cff). See [SUCCESSION.md](SUCCESSION.md) for how to fork and continue this if it ever goes stale.
