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
