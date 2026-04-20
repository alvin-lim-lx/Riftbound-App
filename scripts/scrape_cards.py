#!/usr/bin/env python3
"""
Riftbound Card Scraper — Website Edition
Fetches card data directly from riftbound.leagueoflegends.com card gallery
and generates a TypeScript cards.ts file.

Usage:
    python3 scripts/scrape_cards.py
    python3 scripts/scrape_cards.py --regenerate
"""

import argparse
import json
import re
import sys
from pathlib import Path

import requests


# ─── Website API ───────────────────────────────────────────────────────────────

GALLERY_URL = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def fetch_card_data() -> list[dict]:
    """Fetch all 950 cards from the website's __NEXT_DATA__ JSON."""
    print(f"Fetching {GALLERY_URL} ...")
    resp = requests.get(GALLERY_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    html = resp.text

    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if not match:
        raise RuntimeError("Could not find __NEXT_DATA__ on card gallery page")

    data = json.loads(match.group(1))
    blades = data["props"]["pageProps"]["page"]["blades"]
    cards = blades[2]["cards"]["items"]
    print(f"Fetched {len(cards)} cards from website")
    return cards


# ─── Field parsers ────────────────────────────────────────────────────────────

# Rarity mapping: website label → CardDefinition rarity
RARITY_MAP = {
    "common":    "Common",
    "uncommon":  "Rare",
    "rare":      "Rare",
    "epic":      "Epic",
    "showcase":  "Legendary",
}

# Domain mapping: website id → Domain label
DOMAIN_MAP = {
    "chaos":     "Chaos",
    "calm":      "Calm",
    "fury":      "Fury",
    "mind":      "Mind",
    "body":      "Body",
    "order":     "Order",
    "colorless": "Colorless",
}

# Set mapping: website set id → CardDefinition set label
SET_MAP = {
    "OGN": "Origins",
    "OGS": "Proving Grounds",
    "SFD": "Spiritforged",
    "UNL": "Unleashed",
    "VEN": "VEN",
}


# Card type mapping: website id → CardDefinition type
CARD_TYPE_MAP = {
    "legend":      "Legend",
    "unit":        "Unit",
    "spell":       "Spell",
    "gear":        "Gear",
    "battlefield": "Battlefield",
    "rune":        "Rune",
}


def resolve_rarity(raw: str) -> str:
    return RARITY_MAP.get(raw.lower(), "Common")


def resolve_domains(raw_values: list) -> list[str]:
    """Convert website domain values list to Domain labels, preserving order."""
    result = []
    for v in raw_values:
        did = v.get("id", "").lower()
        mapped = DOMAIN_MAP.get(did)
        if mapped and mapped not in result:
            result.append(mapped)
    return result


def resolve_set(raw: str) -> str:
    return SET_MAP.get(raw.upper(), raw)


def clean_ability_text(html: str) -> str:
    """Strip HTML tags and normalise whitespace."""
    if not html:
        return ""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", html)
    text = text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("\\n", " ").replace("\n", " ").replace("\\r", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ─── Keyword extraction ────────────────────────────────────────────────────────

KNOWN_KEYWORDS = [
    "Ambush", "Assault", "Deflect", "Ganking", "Hidden", "Hunt",
    "Accelerate", "Temporary", "Legions", "Lifesteal", "SpellShield",
    "Quick", "Fearsome", "Elusive", "Repeat", "Action", "Reaction",
    "Equip", "Recall", "Shield", "Buff", "Stun", "Banish", "Recycle",
    "Tank", "Mighty", "Weaponmaster", "Predict",
]


def extract_keywords(text: str) -> list[str]:
    if not text:
        return []
    found = []
    lower = text.lower()
    for kw in KNOWN_KEYWORDS:
        pattern = r"\b" + re.escape(kw.lower()) + r"\b"
        if re.search(pattern, lower):
            found.append(kw)
    return found


# ─── Website card → CardDefinition dict ──────────────────────────────────────

def is_normal_card(card: dict) -> bool:
    """Exclude alternate-art ('star') and overnumbered (letter suffix) cards."""
    cid = card.get("id", "")
    if "star" in cid:
        return False
    # e.g. ogn-119a-298 — letter suffix after card number before set-size
    if re.match(r"^[a-z]+-[0-9]+[a-z]-[0-9]+$", cid):
        return False
    return True


def super_type_for_card(card: dict, card_type: str, legend_tag_set: set[str]) -> str | None:
    """
    Determine superType for a card based on the website data.
    - Champions: cardType.superType contains 'champion', OR the card has a 'power' field
      (power = charge resource, present on champion units)
    - Signatures: cardType.superType contains 'signature', OR the card is not a Legend
      and has a tag matching a legend's champion name
    - Otherwise: None
    """
    # Read superType directly from the website's cardType.superType array
    super_ids = [s.get("id", "").lower()
                 for s in (card.get("cardType", {}).get("superType", []) or [])]

    if "champion" in super_ids:
        return "Champion"
    if "signature" in super_ids:
        # Only non-Legend cards can be Signatures
        if card_type == "Legend":
            return None
        return "Signature"

    # Fallback for champions that lack superType but have power (charge resource)
    power_val = card.get("power")
    if power_val is not None:
        return "Champion"

    # Fallback signature: tag matches a legend's champion name
    if card_type != "Legend":
        tags = card.get("tags", {}).get("tags", [])
        if tags and tags[0] in legend_tag_set:
            return "Signature"

    return None


def website_card_to_def(card: dict, legend_tag_set: set[str]) -> dict | None:
    """
    Convert a raw website card dict to a CardDefinition dict.

    Website card fields:
      id, name, cardType.type[0].id, energy.value.id, might.value.id,
      power.value.id (Champion marker), mightBonus.value.id (Gear might),
      domain.values[].label, rarity.value.label, set.value.label,
      tags.tags[], text.richText.body, effect.richText.body,
      cardImage.url
    """
    card_id = str(card.get("id") or "").strip()
    if not card_id:
        return None

    if not is_normal_card(card):
        return None

    name = str(card.get("name") or "").strip()

    # Card type
    card_type_raw = card.get("cardType", {}).get("type", [{}])[0].get("id", "unknown")
    card_type = CARD_TYPE_MAP.get(card_type_raw, card_type_raw.title())
    super_type = super_type_for_card(card, card_type, legend_tag_set)

    # Energy / rune cost
    energy_val = card.get("energy")
    rune_cost = None
    if energy_val is not None:
        rune_cost = energy_val.get("value", {}).get("id")
        if rune_cost is not None:
            rune_cost = int(rune_cost)

    # Power / charge cost (Champion marker)
    power_val = card.get("power")
    power_cost = None
    if power_val is not None:
        power_cost = power_val.get("value", {}).get("id")
        if power_cost is not None:
            power_cost = int(power_cost)

    # Build cost object (only include if rune_cost is set)
    cost = None
    if rune_cost is not None:
        cost = {"rune": rune_cost}
        if power_cost is not None:
            cost["power"] = power_cost

    # Might stat: use might.value.id for units, mightBonus.value.id for gear
    might_val = card.get("might")
    might = None
    if might_val is not None:
        might = might_val.get("value", {}).get("id")
        if might is not None:
            might = int(might)

    might_bonus_val = card.get("mightBonus")
    if might_bonus_val is not None:
        mb = might_bonus_val.get("value", {}).get("id")
        if mb is not None:
            might = int(mb)

    stats = {"might": might} if might is not None else None

    # Rarity
    rarity_raw = card.get("rarity", {}).get("value", {}).get("label", "")
    rarity = resolve_rarity(rarity_raw)

    # Domains
    domain_values = card.get("domain", {}).get("values", [])
    domains = resolve_domains(domain_values)

    # Tags
    tags_list = card.get("tags", {}).get("tags", [])

    # Abilities — text.richText.body is primary, effect.richText.body is secondary
    text_body = card.get("text", {}).get("richText", {}).get("body", "") or ""
    effect_body = card.get("effect", {}).get("richText", {}).get("body", "") or ""

    primary_text = clean_ability_text(text_body)
    keywords = extract_keywords(primary_text)

    abilities = []
    if primary_text:
        abilities.append({"trigger": "Static", "effect": primary_text, "effectCode": ""})
    if effect_body:
        eff_text = clean_ability_text(effect_body)
        if eff_text:
            abilities.append({"trigger": "Static", "effect": eff_text, "effectCode": ""})

    # Image URL
    image_url = card.get("cardImage", {}).get("url", "") or ""

    # Set
    set_raw = card.get("set", {}).get("value", {}).get("id", "")
    card_set = resolve_set(set_raw)

    # Champion name — for Legend cards, first tag is the champion name
    champion_name = None
    if card_type == "Legend" and tags_list:
        champion_name = tags_list[0]

    return {
        "id": card_id,
        "name": name,
        "type": card_type,
        "superType": super_type,
        "cost": cost,
        "domains": domains,
        "keywords": keywords,
        "stats": stats,
        "abilities": abilities,
        "tags": tags_list,
        "set": card_set,
        "rarity": rarity,
        "imageUrl": image_url,
        "championName": champion_name,
    }


# ─── TypeScript generation ─────────────────────────────────────────────────────

def escape_str(s: str) -> str:
    """Basic string escaping for TypeScript string literals."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'")


def typescript_field(card: dict, field: str) -> str | None:
    """Return the TypeScript-formatted line for a single card field."""
    v = card.get(field)

    if field == "id":
        return f"    id: '{card['id']}',"

    if field == "name":
        return f'    name: "{escape_str(card["name"])}",'

    if field == "type":
        return f"    type: '{card['type']}',"

    if field == "superType":
        if v:
            return f"    superType: '{v}',"
        return None

    if field == "cost":
        if not v:
            return None
        rune = v.get("rune")
        power = v.get("power")
        if power is not None:
            return f"    cost: {{ rune: {rune}, power: {power} }},"
        return f"    cost: {{ rune: {rune} }},"

    if field == "domains":
        domains = v or []
        if domains:
            domains_str = ", ".join(f'"{d}"' for d in domains)
            return f"    domains: [{domains_str}],"
        return "    domains: [],"

    if field == "keywords":
        kw = v or []
        if kw:
            kw_str = ", ".join(f"'{k}'" for k in kw)
            return f"    keywords: [{kw_str}],"
        return "    keywords: [],"

    if field == "stats":
        if not v:
            return None
        parts = []
        if "might" in v:
            parts.append(f"might: {v['might']}")
        if "health" in v:
            parts.append(f"health: {v['health']}")
        if parts:
            return f"    stats: {{ {', '.join(parts)} }},"
        return None

    if field == "abilities":
        ab = v or []
        if not ab:
            return "    abilities: [],"
        lines = ["    abilities: ["]
        for a in ab:
            trigger = a.get("trigger", "Static")
            effect = escape_str(a.get("effect", ""))
            lines.append(f"      {{ trigger: '{trigger}', effect: \"{effect}\", effectCode: '' }},")
        lines.append("    ],")
        return "\n".join(lines)

    if field == "tags":
        t = v or []
        if t:
            tags_str = ", ".join(f'"{escape_str(tag)}"' for tag in t)
            return f"    tags: [{tags_str}],"
        return "    tags: [],"

    if field == "set":
        return f"    set: '{v}',"

    if field == "rarity":
        return f"    rarity: '{v}',"

    if field == "imageUrl":
        if v:
            return f"    imageUrl: '{v}',"
        return None

    if field == "championName":
        if v:
            return f'    championName: "{escape_str(v)}",'
        return None

    return None


# ─── Regenerate cards.ts ───────────────────────────────────────────────────────

def regenerate_cards_ts(cards: list[dict], output_path: str):
    """Regenerate the entire cards.ts from the card list."""
    sorted_cards = sorted(cards, key=lambda c: c["id"])

    lines = []
    lines.append("// Riftbound Card Database")
    lines.append("// Auto-generated from riftbound.leagueoflegends.com/card-gallery/")
    lines.append(f"// Total cards: {len(sorted_cards)}")
    lines.append("")
    lines.append("import type { CardDefinition } from './types';")
    lines.append("")
    lines.append("export const CARDS: Record<string, CardDefinition> = {")

    for card in sorted_cards:
        lines.append(f"  '{card['id']}': {{")

        for field in ["id", "name", "type", "superType", "cost", "domains",
                       "keywords", "stats", "abilities", "tags", "set",
                       "rarity", "imageUrl", "championName"]:
            line = typescript_field(card, field)
            if line:
                lines.append(line)

        lines.append("  },")

    lines.append("};")
    lines.append("")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Wrote {len(sorted_cards)} cards to {output_path}")


# ─── Stats / reporting ─────────────────────────────────────────────────────────

def print_coverage(cards: list[dict]):
    total = len(cards)
    with_cost = sum(1 for c in cards if c.get("cost"))
    with_might = sum(1 for c in cards if (c.get("stats") or {}).get("might"))
    with_domains = sum(1 for c in cards if c.get("domains"))
    with_tags = sum(1 for c in cards if c.get("tags"))
    with_image = sum(1 for c in cards if c.get("imageUrl"))
    champions = sum(1 for c in cards if c.get("superType") == "Champion")
    signatures = sum(1 for c in cards if c.get("superType") == "Signature")
    legends = sum(1 for c in cards if c.get("type") == "Legend")

    print(f"\nCoverage in {total} normal cards:")
    print(f"  cost (energy/rune):  {with_cost}")
    print(f"  stats.might:          {with_might}")
    print(f"  domains:             {with_domains}")
    print(f"  tags:                {with_tags}")
    print(f"  imageUrl:            {with_image}")
    print(f"  Champions (superType): {champions}")
    print(f"  Signatures (superType): {signatures}")
    print(f"  Legends (type=legend):  {legends}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scrape Riftbound card data from website")
    parser.add_argument(
        "--output",
        default="shared/src/cards.ts",
        help="Output TypeScript file path",
    )
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="Regenerate cards.ts (default when running directly)",
    )
    args = parser.parse_args()

    output_path = Path(__file__).parent.parent / args.output

    # Fetch card data from website
    raw_cards = fetch_card_data()

    # Build legend tag set first (needed for superType detection)
    legend_tag_set = set()
    for c in raw_cards:
        if c.get("cardType", {}).get("type", [{}])[0].get("id") == "legend":
            tags = c.get("tags", {}).get("tags", [])
            if tags:
                legend_tag_set.add(tags[0])

    print(f"Found {len(legend_tag_set)} unique legend champion names")

    # Convert all cards
    carddefs = []
    skipped = 0
    for raw in raw_cards:
        defn = website_card_to_def(raw, legend_tag_set)
        if defn:
            carddefs.append(defn)
        else:
            skipped += 1

    print(f"Converted {len(carddefs)} cards ({skipped} skipped as non-normal)")

    print_coverage(carddefs)
    regenerate_cards_ts(carddefs, str(output_path))

    # Verify build
    print("\nVerifying TypeScript syntax...")
    import subprocess
    result = subprocess.run(
        ["npx", "tsc", "--noEmit", "--skipLibCheck",
         str(output_path)],
        cwd=Path(__file__).parent.parent / "frontend",
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode == 0:
        print("TypeScript check passed.")
    else:
        print("TypeScript errors:")
        print(result.stdout[-2000:])


if __name__ == "__main__":
    main()
