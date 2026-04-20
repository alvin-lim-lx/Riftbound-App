#!/usr/bin/env python3
"""
Riftbound Card Scraper — fetches live data from https://riftbound.leagueoflegends.com/en-us/card-gallery/
Extracts all ~955 cards (units, spells, gears, battlefields, runes, legends, champions, signatures).

Website data structure (from __NEXT_DATA__ → pageProps.page.blades[riftboundCardGallery].cards.items):
  - id, name, collectorNumber, publicCode, orientation
  - set: { value: { id, label } }
  - domain: { values: [{ id, label }] }
  - rarity: { value: { id, label } }
  - cardType.type: [{ id, label }]     ← unit/spell/gear/battlefield/rune/legend
  - cardType.superType: [{ id, label }] ← champion/signature/token/basic (non-legends only)
  - energy: { value: { id } }          ← rune cost
  - might: { value: { id } }            ← might stat (units/champions)
  - power: { value: { id } }           ← power cost (champions/signatures only)
  - tags: { tags: [str] }              ← champion name for legends; champion tag+region for champions
  - text.richText.body: html string     ← ability text
  - cardImage.url: str                  ← image URL
  - illustrator.values: [{ id, label }] ← artist

Usage:
    python3 scripts/scrape_cards_from_web.py
    python3 scripts/scrape_cards_from_web.py --output shared/src/cards.ts
"""

import argparse
import json
import re
import sys
from pathlib import Path

import requests

# ── URL ────────────────────────────────────────────────────────────────────────
CARD_GALLERY_URL = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"
NEXT_DATA_RE = re.compile(
    r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>([^<]+)</script>',
    re.IGNORECASE,
)

# ── Rarity mapping ─────────────────────────────────────────────────────────────
RARITY_MAP = {
    "common":      "Common",
    "uncommon":    "Uncommon",
    "rare":        "Rare",
    "epic":        "Epic",
    "showcase":    "Showcase",
    "uncollected": "Common",
}

# ── Domain mapping ─────────────────────────────────────────────────────────────
DOMAIN_MAP = {
    "chaos":      "Chaos",
    "calm":       "Calm",
    "fury":       "Fury",
    "mind":       "Mind",
    "body":       "Body",
    "order":      "Order",
    "colorless":  "Colorless",
}


def resolve_domains(domain_values: list[dict]) -> list[str]:
    """Convert list of {id, label} domain objects → list of Domain strings."""
    result = []
    seen = set()
    for dv in domain_values:
        did = dv.get("id", "").strip().lower()
        mapped = DOMAIN_MAP.get(did)
        if mapped and mapped not in seen:
            seen.add(mapped)
            result.append(mapped)
    return result


# ── Set mapping ────────────────────────────────────────────────────────────────
SET_MAP = {
    "OGN": "Origins",
    "OGS": "Proving Grounds",
    "SFD": "Spiritforged",
    "UNL": "Unleashed",
    "VEN": "Ven",
}


def resolve_set(set_value: dict | None) -> str:
    if not set_value:
        return "Origins"
    sid = set_value.get("id", "").upper()
    return SET_MAP.get(sid, set_value.get("label", "Origins"))


# ── Keyword extraction ─────────────────────────────────────────────────────────
KNOWN_KEYWORDS = [
    "Ambush", "Assault", "Deflect", "Ganking", "Hidden", "Hunt",
    "Accelerate", "Temporary", "Legions", "Lifesteal", "SpellShield",
    "Quick", "Fearsome", "Elusive", "Repeat", "Action", "Reaction",
    "Equip", "Recall", "Shield", "Buff", "Stun", "Banish", "Recycle",
    "Tank", "Mighty", "Weaponmaster", "Predict",
]


def clean_html(text: str) -> str:
    """Strip HTML tags and normalise whitespace; convert Riot tokens to readable symbols."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("\\n", " ").replace("\n", " ").replace("\\r", " ")
    # Convert Riot's :rb_xxx: tokens to readable form
    text = re.sub(r":rb_energy_(\d):", lambda m: f"[{m.group(1)}]", text)
    text = re.sub(r":rb_exhaust:", "[T]", text)
    text = re.sub(r":rb_might:", "[S]", text)
    text = re.sub(r":rb_([a-z_]+):", r"[\1]", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


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


# ── Image URL ──────────────────────────────────────────────────────────────────
def resolve_image_url(card_image: dict | None) -> str:
    if not card_image:
        return ""
    url = card_image.get("url", "")
    return url.split("?")[0] if url else ""


# ── Website card → CardDefinition ─────────────────────────────────────────────
# Website uses LOWERCASE type IDs (unit/spell/gear/battlefield/rune/legend).
# TypeScript expects CAPITALIZED labels (Unit/Spell/Gear/etc.).
_TYPE_LABEL = {
    "unit":        "Unit",
    "spell":       "Spell",
    "gear":        "Gear",
    "battlefield": "Battlefield",
    "rune":        "Rune",
}


def website_card_to_carddef(wc: dict) -> dict | None:
    """
    Convert a raw website card dict into a CardDefinition dict.
    Returns None for tokens and basic runes (not playable).
    """
    card_id = str(wc.get("id") or "").strip()
    if not card_id:
        return None

    name = str(wc.get("name") or "").strip()

    # ── Card type / superType ─────────────────────────────────────────────
    type_ids  = [t.get("id", "").strip().lower()
                 for t in (wc.get("cardType", {}).get("type", []) or [])]
    super_ids = [s.get("id", "").strip().lower()
                 for s in (wc.get("cardType", {}).get("superType", []) or [])]

    # Skip tokens entirely
    if "token" in super_ids:
        return None

    # Determine type and superType
    if "legend" in type_ids:
        card_type, super_type = "Legend", None
    elif "champion" in super_ids:
        card_type, super_type = "Unit", "Champion"
    elif "signature" in super_ids:
        card_type, super_type = "Unit", "Signature"
    elif "basic" in super_ids:
        # Basic runes — playable rune-deck cards (superType=basic, type=rune)
        card_type = "Rune"
        super_type = None
    else:
        # Regular card — map lowercase → capitalized
        card_type = next(
            (_TYPE_LABEL[t] for t in type_ids if t in _TYPE_LABEL),
            "Unit",
        )
        super_type = None

    # ── Rune cost (energy) ─────────────────────────────────────────────────
    energy_val = wc.get("energy", {})
    try:
        rune_cost = int(energy_val.get("value", energy_val.get("id"))
                        ) if energy_val else None
    except (ValueError, TypeError):
        rune_cost = None

    # ── Power cost ─────────────────────────────────────────────────────────
    power_val = wc.get("power", {})
    try:
        power_cost = int(power_val.get("value", power_val.get("id"))
                         ) if power_val else None
    except (ValueError, TypeError):
        power_cost = None

    # ── Might (stat) ───────────────────────────────────────────────────────
    might_val = wc.get("might", {})
    try:
        might = int(might_val.get("value", might_val.get("id"))
                    ) if might_val else None
    except (ValueError, TypeError):
        might = None

    stats = {"might": might} if might is not None else {}

    # ── Rarity ─────────────────────────────────────────────────────────────
    rarity_val = wc.get("rarity", {}).get("value", {})
    rarity_id  = str(rarity_val.get("id", "common")).strip().lower()
    rarity     = RARITY_MAP.get(rarity_id, "Common")

    # ── Domains ───────────────────────────────────────────────────────────
    domains = resolve_domains(wc.get("domain", {}).get("values", []))

    # ── Tags ──────────────────────────────────────────────────────────────
    tags_obj = wc.get("tags", {})
    tags = tags_obj.get("tags", []) if isinstance(tags_obj, dict) else []
    tags = [str(t).strip() for t in tags if t]

    # ── Ability text ───────────────────────────────────────────────────────
    rich_text    = wc.get("text", {}).get("richText", {})
    ability_html = rich_text.get("body", "") if isinstance(rich_text, dict) else ""
    ability_text = clean_html(ability_html)
    keywords     = extract_keywords(ability_text)
    abilities    = [{"trigger": "Static", "effect": ability_text, "effectCode": ""}] \
                   if ability_text else []

    # ── Image URL ──────────────────────────────────────────────────────────
    image_url = resolve_image_url(wc.get("cardImage", {}))

    # ── Set ────────────────────────────────────────────────────────────────
    card_set = resolve_set(wc.get("set", {}).get("value"))

    # ── Assemble CardDefinition ───────────────────────────────────────────
    carddef: dict = {
        "id":         card_id,
        "name":       name,
        "type":       card_type,
        "domains":    domains,
        "keywords":   keywords,
        "stats":      stats or None,
        "abilities":  abilities,
        "tags":       tags,
        "set":        card_set,
        "rarity":     rarity,
        "imageUrl":   image_url,
    }

    if super_type:
        carddef["superType"] = super_type

    cost = {}
    if rune_cost is not None:
        cost["rune"] = rune_cost
    if power_cost is not None:
        cost["power"] = power_cost
    if cost:
        carddef["cost"] = cost

    return carddef


# ── Legend → championName lookup ───────────────────────────────────────────────
def build_legend_champion_map(cards: list[dict]) -> dict[str, str]:
    """For every Legend card, tags[0] is the champion name. Returns {legend_id: champion_name}."""
    return {
        c["id"]: c["tags"][0]
        for c in cards
        if c.get("type") == "Legend" and c.get("tags")
    }


# ── TypeScript generation ───────────────────────────────────────────────────────
def _escape(s: str) -> str:
    return (s.replace("\\", "\\\\")
             .replace('"', '\\"')
             .replace("'", "\\'"))


_CARDDEF_FIELDS = [
    "id", "name", "type", "superType", "cost", "domains",
    "keywords", "stats", "abilities", "tags", "set", "rarity", "imageUrl",
]


def _ts_field(card: dict, field: str) -> str | None:
    v = card.get(field)

    if field == "id":
        return f"    id: '{card['id']}',"

    if field == "name":
        return f'    name: "{_escape(card["name"])}",'

    if field == "type":
        return f"    type: '{card['type']}',"

    if field == "superType":
        return f"    superType: '{v}'," if v else None

    if field == "cost":
        if not v:
            return None
        rune, power = v.get("rune"), v.get("power")
        if power is not None:
            return f"    cost: {{ rune: {rune}, power: {power} }},"
        return f"    cost: {{ rune: {rune} }},"

    if field == "domains":
        d = v or []
        return (f"    domains: [{', '.join(f'\"{d2}\"' for d2 in d)}],"
                if d else "    domains: [],")

    if field == "keywords":
        kw = v or []
        if kw:
            inner = ", ".join(f"'{k}'" for k in kw)
            return f"    keywords: [{inner}],"
        return "    keywords: [],"

    if field == "stats":
        if not v:
            return None
        parts = [f"might: {v['might']}"] if "might" in v else []
        parts += [f"health: {v['health']}"] if "health" in v else []
        return f"    stats: {{ {', '.join(parts)} }}," if parts else None

    if field == "abilities":
        ab = v or []
        if not ab:
            return "    abilities: [],"
        lines = ["    abilities: ["]
        for a in ab:
            lines.append(
                f'      {{ trigger: "{a.get("trigger", "Static")}", '
                f'effect: "{_escape(a.get("effect", ""))}", effectCode: "" }},'
            )
        lines.append("    ],")
        return "\n".join(lines)

    if field == "tags":
        t = v or []
        return (f"    tags: [{', '.join(f'\"{_escape(tag)}\"' for tag in t)}],"
                if t else "    tags: [],")

    if field == "set":
        return f"    set: '{v}',"

    if field == "rarity":
        return f"    rarity: '{v}',"

    if field == "imageUrl":
        return f"    imageUrl: '{v}'," if v else None

    return None


def generate_typescript(cards: list[dict], legend_map: dict[str, str]) -> str:
    lines = [
        "// Riftbound Card Database",
        "// Auto-generated from riftbound.leagueoflegends.com/en-us/card-gallery/",
        f"// Total cards: {len(cards)}",
        "",
        "import type { CardDefinition } from './types';",
        "",
        "export const CARDS: Record<string, CardDefinition> = {",
    ]

    for card in cards:
        lines.append(f"  '{card['id']}': {{")
        for field in _CARDDEF_FIELDS:
            line = _ts_field(card, field)
            if line:
                lines.append(line)

        if card.get("type") == "Legend":
            champ = legend_map.get(card["id"])
            if champ:
                lines.append(f'    championName: "{_escape(champ)}",')

        lines.append("  },")

    lines.append("};")
    lines.append("")
    return "\n".join(lines)


# ── Fetch page & extract cards ────────────────────────────────────────────────
def fetch_card_data(url: str) -> list[dict]:
    print(f"Fetching {url} ...")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()

    match = NEXT_DATA_RE.search(resp.text)
    if not match:
        raise RuntimeError("Could not find __NEXT_DATA__ in page HTML")

    next_data = json.loads(match.group(1))
    blades = (
        next_data
        .get("props", {})
        .get("pageProps", {})
        .get("page", {})
        .get("blades", [])
    )
    gallery = next(
        (b for b in blades if b.get("type") == "riftboundCardGallery"),
        None,
    )
    if not gallery:
        raise RuntimeError("Could not find riftboundCardGallery blade in __NEXT_DATA__")

    items = gallery.get("cards", {}).get("items", [])
    if not items:
        raise RuntimeError("No card items found in gallery data")

    print(f"Found {len(items)} card items in page data")
    return items


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Scrape Riftbound card data from the official website"
    )
    parser.add_argument(
        "--output",
        default="shared/src/cards.ts",
        help="Output TypeScript file path",
    )
    args = parser.parse_args()
    output_path = Path(__file__).parent.parent / args.output

    # 1. Fetch
    raw_cards = fetch_card_data(CARD_GALLERY_URL)

    # 2. Convert
    cards   = []
    skipped = 0
    for wc in raw_cards:
        carddef = website_card_to_carddef(wc)
        if carddef is not None:
            cards.append(carddef)
        else:
            skipped += 1

    print(f"Converted {len(cards)} cards ({skipped} skipped as tokens/basic-runes)")

    # 3. Legend map
    legend_map = build_legend_champion_map(cards)
    print(f"Legends with championName: {len(legend_map)}")

    # 4. Stats
    def cnt(**kwargs) -> int:
        return sum(1 for c in cards if all(c.get(k) == v for k, v in kwargs.items()))

    legends      = cnt(type="Legend")
    champions    = cnt(superType="Champion")
    signatures   = cnt(superType="Signature")
    units        = cnt(type="Unit", superType=None)
    spells       = cnt(type="Spell")
    gears        = cnt(type="Gear")
    battlefields = cnt(type="Battlefield")
    runes        = cnt(type="Rune")
    with_tags    = sum(1 for c in cards if c.get("tags"))
    with_domains = sum(1 for c in cards if c.get("domains"))
    with_image   = sum(1 for c in cards if c.get("imageUrl"))

    print(f"  Legends:      {legends}")
    print(f"  Champions:    {champions}")
    print(f"  Signatures:   {signatures}")
    print(f"  Units (base): {units}")
    print(f"  Spells:       {spells}")
    print(f"  Gear:         {gears}")
    print(f"  Battlefields: {battlefields}")
    print(f"  Runes:        {runes}")
    print(f"  Cards with tags:    {with_tags}")
    print(f"  Cards with domains: {with_domains}")
    print(f"  Cards with image:   {with_image}")

    # 5. Sort by id
    cards.sort(key=lambda c: c["id"])

    # 6. Generate TypeScript
    ts_content = generate_typescript(cards, legend_map)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(ts_content, encoding="utf-8")
    print(f"Wrote {len(cards)} cards → {output_path}")


if __name__ == "__main__":
    main()
