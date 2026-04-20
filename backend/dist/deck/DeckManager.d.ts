/**
 * Deck Manager — Backend Service
 * ===============================
 * In-memory deck storage with validation against the card database.
 * Provides CRUD operations for player decks.
 *
 * Deck structure (Piltover legal format):
 *   - 1 Legend card (type=Legend, plays on board)
 *   - 39 main deck cards (Units/Spells/Gears, includes champion unit)
 *   - 12 rune deck cards (2 copies each of 6 rune types)
 *   - 3 battlefields (first is starting battlefield)
 *   - 8 sideboard cards
 */
import type { Deck, DeckValidation } from '../../shared/src/types';
export declare class DeckManager {
    static create(playerId: string, name: string, legendId: string, cardIds: string[], runeIds: string[], battlefieldIds: string[], sideboardIds: string[]): Deck;
    static get(id: string): Deck | undefined;
    static getByPlayer(playerId: string): Deck[];
    static update(id: string, patches: Partial<Pick<Deck, 'name' | 'legendId' | 'cardIds' | 'runeIds' | 'battlefieldIds' | 'sideboardIds'>>): Deck | null;
    static delete(id: string): boolean;
    static validate(deck: Omit<Deck, 'id' | 'playerId' | 'createdAt' | 'updatedAt'>): DeckValidation;
    /**
     * Expand a deck into card instance ids for game initialization.
     * Returns array of card ids:
     *   - 1 legend
     *   - 2 copies of each main deck card
     *   - 2 copies of each rune card
     * Shuffled (legend position is preserved separately, not shuffled).
     */
    static expandDeck(deck: Deck): string[];
}
//# sourceMappingURL=DeckManager.d.ts.map