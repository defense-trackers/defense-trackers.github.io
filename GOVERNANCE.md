# Governance & operating posture

This project is a neutral, public-interest data utility. It aggregates only public
information and is built to remain citable and continuable regardless of who runs it.
This file records the integrity guarantees that are in place and the human
responsibilities that remain.

## Integrity guarantees (in place)

- **Append-only, hash-chained changelog.** Every change is one event with
  `prev = sha256(previous event)`; the head is in `CHAIN`. Re-derive with
  `engine verify` — no keys needed.
- **Independent timestamp anchor.** Each new head is timestamped by a public RFC 3161
  TSA (token in `CHAIN.tsr`). `engine verify` confirms the token commits to a real
  head in the chain's history, so a coordinated rewrite (editing events *and*
  recomputing `CHAIN`) is detected — something a bare hash chain cannot catch.
  Independent validation: `openssl ts -verify -data CHAIN -in CHAIN.tsr -CAfile <tsa-ca>`.
- **Optional signature.** When a `signet` key is configured (`SIGNET_CMD`), the head is
  also countersigned (`CHAIN.sig`).
- **Branch protection.** `main` on both repos blocks force-pushes and deletions, so
  history cannot be silently rewritten.
- **Honest freshness.** A failed fetch never overwrites good data; the source is marked
  degraded/stale and the badge reflects it. The sentinel and chain-verify steps open a
  GitHub issue on stale sources or verification failure.

## The human floor (irreducible)

This system is **low-touch, not zero-touch.** The following require a human:

1. **SAM.gov API key rotation (~quarterly).** Regenerate at sam.gov → Account Details →
   API Key and update the `SAM_API_KEY` secret. A weekly canary opens an issue if the
   key starts failing. (Optional: move to a SAM system account for a longer-lived key.)
2. **Heartbeat monitor.** Create a check at healthchecks.io (or similar) and set the
   `HEARTBEAT_URL` secret. The pipeline pings it only on a fully successful run; if the
   whole pipeline stops, the monitor pages you. *Until this is set, total silence is the
   one failure mode with no automatic alert.*
3. **Second owner.** The org is currently a single-owner free org (bus factor of one).
   Add a second org owner / team so the project survives loss of one account.
4. **Legal sign-off.** Confirm with JAG/ethics that neutral-org aggregation of public
   information is clean for the maintainer's status, and keep an IP-provenance note
   (built on personal time/equipment).

## Continuation

If updates stop, the data remains a correctly-dated, independently-verifiable archive.
Anyone can fork the engine and the data and resume — see `SUCCESSION.md`. The chain and
its timestamps make the forked history verifiable back to this origin.
