# Succession

This project is designed to outlive any single maintainer. If the freshness
badges on the home page (or `data/status.json`) show everything stale for
180+ days, treat it as abandoned and fork freely.

## What you're getting
- `data/<tracker>/current.json` — live state per tracker.
- `data/<tracker>/events/<year>.jsonl` — the append-only, hash-chained changelog.
- `data/<tracker>/CHAIN` — the current chain head.
- `data/status.json` — per-source freshness and state (what the badges render).
- `feeds/<tracker>.xml` — generated RSS.
- The engine (separate repo) regenerates all of this from public sources.

## To continue it
1. Fork this repo and the engine repo.
2. Verify the existing chain before trusting any history:
   `engine verify --out .` re-derives every event hash and reports tampering.
3. Point the engine's CI secrets at your own keys (see the engine README).
4. Your first commit is the fork point. The prior chain proves exactly where
   the previous maintainer's continuity ended and yours began — that
   cryptographic seam is the point.

## License
Data is CC-BY-4.0 (attribute the source). Site and engine code are MIT.
Attribution is not a formality here — it is how a canonical source stays
canonical.
