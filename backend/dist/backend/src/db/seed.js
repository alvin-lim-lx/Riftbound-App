"use strict";
/**
 * Database seeding script
 * Populates cards table from shared card definitions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedCards = seedCards;
const cards_1 = require("../../../shared/src/cards");
function seedCards() {
    const statements = [];
    for (const [id, card] of Object.entries(cards_1.CARDS)) {
        const values = [
            id,
            card.name,
            card.type,
            JSON.stringify(card.cost ?? null),
            `{${card.domains.join(',')}}`,
            `{${card.keywords.join(',')}}`,
            JSON.stringify(card.stats ?? null),
            JSON.stringify(card.abilities),
            card.set,
            card.rarity,
            card.imageUrl ?? null,
        ];
        const cols = [
            'id', 'name', 'type', 'cost', 'domains', 'keywords',
            'stats', 'abilities', 'set_name', 'rarity', 'image_url'
        ];
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        statements.push(`INSERT INTO cards (${cols.join(', ')}) VALUES (${placeholders}) ` +
            `ON CONFLICT (id) DO UPDATE SET ` +
            cols.map((c, i) => `${c} = EXCLUDED.${c}`).join(', '));
    }
    return statements.join(';\n') + ';';
}
if (require.main === module) {
    console.log('Card seed SQL:');
    console.log(seedCards());
}
