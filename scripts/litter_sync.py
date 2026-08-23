#!/usr/bin/env python3
"""Archive Yoshi's Litter-Robot readings into data/litter.json.

Whisker only shows the last 7 days unless you pay for Whisker+. This runs
once a day and appends anything new to a file we own, so the history builds
up on our side for free.

Needs WHISKER_EMAIL and WHISKER_PASSWORD in the environment. Without them it
exits quietly, so the workflow can sit dormant until the secrets are added.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pylitterbot import Account

OUT = Path(__file__).resolve().parent.parent / "data" / "litter.json"
ALERT_FILE = Path(__file__).resolve().parent.parent / "data" / "watch-alert.txt"
LB_TO_KG = 0.45359237

# The Whisker API hands weights back in pounds, so that is the default. If the
# site ends up showing roughly half his real weight, set the LITTER_WEIGHT_UNIT
# repository variable to "kg" — every reading keeps its raw value, so switching
# and re-running fixes the whole history.
UNIT = os.environ.get("LITTER_WEIGHT_UNIT", "lb").strip().lower()
LIMIT = int(os.environ.get("LITTER_HISTORY_LIMIT", "200"))


def to_kg(raw: float) -> float:
    """Convert one reading to kilograms."""
    return round(float(raw) * (LB_TO_KG if UNIT == "lb" else 1.0), 2)


# How much history before the numbers mean anything. Under this the watch says
# it is still learning rather than pretending to know what normal looks like.
MIN_DAYS = 21
MIN_READINGS = 15
RECENT, BASE = 7, 28


def analyse(readings: list[dict]) -> dict:
    """Compare the last week against the month before it.

    A cat hides illness, but two things leak: how often it uses the box and
    what it weighs. This does not diagnose anything - it just says when the
    numbers have moved far enough to be worth a look.
    """
    if not readings:
        return {"status": "no data"}

    stamps = [datetime.fromisoformat(r["t"]) for r in readings]
    now = max(stamps)
    span_days = (now - min(stamps)).days

    if span_days < MIN_DAYS or len(readings) < MIN_READINGS:
        return {"status": "learning", "days": span_days,
                "days_needed": MIN_DAYS, "readings": len(readings)}

    def window(lo, hi):
        """Readings between lo and hi days ago."""
        return [r for r, t in zip(readings, stamps)
                if lo <= (now - t).days < hi]

    recent, base = window(0, RECENT), window(RECENT, RECENT + BASE)
    if not recent or not base:
        return {"status": "learning", "days": span_days,
                "days_needed": MIN_DAYS, "readings": len(readings)}

    def per_day(rs, days):
        return round(len(rs) / days, 2)

    def mean_kg(rs):
        kg = [r["kg"] for r in rs if r.get("kg")]
        return round(sum(kg) / len(kg), 2) if kg else None

    r_kg, b_kg = mean_kg(recent), mean_kg(base)
    r_visits, b_visits = per_day(recent, RECENT), per_day(base, BASE)

    flags = []
    if r_kg and b_kg:
        change = (r_kg - b_kg) / b_kg
        if change <= -0.04:
            flags.append({"kind": "weight-down", "detail":
                f"Averaging {r_kg} kg this week against {b_kg} kg over the month before "
                f"— down {abs(change)*100:.1f}%. Steady weight loss is worth a vet's opinion."})
        elif change >= 0.06:
            flags.append({"kind": "weight-up", "detail":
                f"Averaging {r_kg} kg this week against {b_kg} kg over the month before "
                f"— up {change*100:.1f}%."})

    if b_visits >= 0.5:
        ratio = r_visits / b_visits
        if ratio >= 1.6:
            flags.append({"kind": "visits-up", "detail":
                f"{r_visits} trips a day this week against {b_visits} normally "
                f"— up {(ratio-1)*100:.0f}%. More frequent visits can be the first sign of "
                f"a urinary or kidney problem."})
        elif ratio <= 0.5:
            flags.append({"kind": "visits-down", "detail":
                f"{r_visits} trips a day this week against {b_visits} normally. "
                f"A sharp drop can mean he is not eating or drinking as usual."})

    return {"status": "flagged" if flags else "steady", "flags": flags,
            "recent_kg": r_kg, "base_kg": b_kg,
            "recent_visits": r_visits, "base_visits": b_visits,
            "days": span_days, "readings": len(readings)}


def load_existing() -> dict:
    """Read the archive we have so far, tolerating a missing or broken file."""
    if OUT.exists():
        try:
            return json.loads(OUT.read_text())
        except json.JSONDecodeError:
            print("existing litter.json is unreadable — starting fresh", file=sys.stderr)
    return {}


async def main() -> int:
    email = os.environ.get("WHISKER_EMAIL")
    password = os.environ.get("WHISKER_PASSWORD")
    if not (email and password):
        print("WHISKER_EMAIL / WHISKER_PASSWORD not set — nothing to sync.")
        return 0

    if UNIT not in ("lb", "kg"):
        print(f"LITTER_WEIGHT_UNIT must be lb or kg, got {UNIT!r}", file=sys.stderr)
        return 1

    if ALERT_FILE.exists():
        ALERT_FILE.unlink()

    data = load_existing()
    pets_out = data.setdefault("pets", {})

    account = Account()
    try:
        await account.connect(
            username=email, password=password, load_robots=False, load_pets=True
        )
        pets = list(account.pets)
        if not pets:
            print("No pets on this Whisker account.", file=sys.stderr)
            return 1

        for pet in pets:
            history = await pet.fetch_weight_history(limit=LIMIT)
            pet_out = pets_out.setdefault(pet.name, {})
            pet_out.update(
                {
                    "id": pet.id,
                    "breed": pet.breed,
                    "gender": str(pet.gender) if pet.gender else None,
                    "unit": UNIT,
                }
            )

            # Each weight reading is one trip to the box, so the readings double
            # as the visit log. Key by timestamp to merge without duplicating.
            readings = {r["t"]: r for r in pet_out.get("readings", [])}
            before = len(readings)
            for measurement in history:
                stamp = measurement.timestamp.astimezone(timezone.utc).isoformat()
                readings[stamp] = {
                    "t": stamp,
                    "raw": round(float(measurement.weight), 3),
                    "kg": to_kg(measurement.weight),
                }
            pet_out["readings"] = sorted(readings.values(), key=lambda r: r["t"])
            pet_out["latest_kg"] = (
                pet_out["readings"][-1]["kg"] if pet_out["readings"] else None
            )

            was = (pet_out.get("watch") or {}).get("flags") or []
            watch = analyse(pet_out["readings"])
            pet_out["watch"] = watch

            # Only shout when something new appears, not every morning it persists.
            new_kinds = {f["kind"] for f in watch.get("flags", [])} - {f["kind"] for f in was}
            if new_kinds:
                alert = ALERT_FILE
                alert.parent.mkdir(parents=True, exist_ok=True)
                alert.write_text(
                    f"{pet.name}: {', '.join(sorted(new_kinds))}\n\n"
                    + "\n\n".join(f["detail"] for f in watch["flags"]
                                   if f["kind"] in new_kinds)
                    + "\n\nFrom the Litter-Robot archive. Not a diagnosis — just a "
                      "change worth a look.\n"
                )
                print(f"FLAGGED {pet.name}: {sorted(new_kinds)}")
            print(
                f"{pet.name}: fetched {len(history)}, "
                f"{len(readings) - before} new, {len(readings)} archived"
            )
    finally:
        await account.disconnect()

    data["updated"] = datetime.now(timezone.utc).isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
