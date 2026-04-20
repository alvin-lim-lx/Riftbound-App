/**
 * Database seeding script
 * Populates cards table from shared card definitions
 */

import { CARDS } from '../../../shared/src/cards';
import type { CardDefinition } from '../../../shared/src/types';

export function seedCards(): string {
  const statements: string[] = [];

  for (const [id, card] of Object.entries(CARDS)) {
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
    statements.push(
      `INSERT INTO cards (${cols.join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT (id) DO UPDATE SET ` +
      cols.map((c, i) => `${c} = EXCLUDED.${c}`).join(', ')
    );
  }

  return statements.join(';\n') + ';';
}

if (require.main === module) {
  console.log('Card seed SQL:');
  console.log(seedCards());
}
