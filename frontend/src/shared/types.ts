// ============================================================
// Shared Types — Riftbound
// Synced with backend/shared/src/types.ts
// ============================================================

// --- Card Types ---

export type CardType = 'Unit' | 'Spell' | 'Gear' | 'Battlefield' | 'Legend' | 'Rune' | 'Champion';

export type Domain = 'Demacia' | 'Noxus' | 'Ionia' | 'Shurima' | 'Freljord' | 'Bilgewater' | 'Piltover' | 'Zaun' | 'Shadow Isles' | 'Void' | 'Ixtal' | 'Bandle';

export type Keyword =
  | 'Ambush'
  | 'Assault'
  | 'Deflect'
  | 'Ganking'
  | 'Hidden'
  | 'Hunt'
  | 'Accelerate'
  | 'Temporary'
  | 'Legions'
  | 'Lifesteal'
  | 'SpellShield'
  | 'Quick'
  | 'Fearsome'
  | 'Elusive'
  | 'Repeat'
  | 'Action'
  | 'Reaction'
  | 'Equip';

export interface CardCost {
  rune: number;
  power?: number;
  charges?: number;
}

export interface CardStats {
  might?: number;
  health?: number;
}

export interface Ability {
  trigger: string;
  effect: string;
  effectCode?: string;
}

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  superType?: 'Champion' | 'Signature';
  cost?: CardCost;
  domains: Domain[];
  keywords: Keyword[];
  stats?: CardStats;
  abilities: Ability[];
  set: string;
  rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary';
  imageUrl?: string;
  flavorText?: string;
}

// --- Game Log Types ---

export type LogEventType =
  | 'game_created'
  | 'phase_entered'
  | 'turn_started'
  | 'mulligan_done'
  | 'card_drawn'
  | 'rune_channeled'
  | 'rune_discarded'
  | 'rune_used'
  | 'unit_played'
  | 'spell_played'
  | 'gear_played'
  | 'gear_equipped'
  | 'unit_moved'
  | 'attack_declared'
  | 'showdown_resolved'
  | 'battlefield_conquered'
  | 'battlefield_scored'
  | 'unit_killed'
  | 'unit_damaged'
  | 'unit_readied'
  | 'unit_exhausted'
  | 'card_hidden'
  | 'card_revealed'
  | 'mana_gained'
  | 'mana_spent'
  | 'charge_gained'
  | 'charge_spent'
  | 'ability_triggered'
  | 'pass'
  | 'game_won'
  | 'auto_score';

export interface GameLogEntry {
  id: string;
  eventType: LogEventType;
  turn: number;
  phase: Phase;
  playerId: string | null;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

// --- Game State Types ---

export type Phase =
  | 'Setup'
  | 'Mulligan'
  | 'Awaken'
  | 'Beginning'
  | 'Channel'
  | 'Draw'
  | 'Action'
  | 'FirstMain'
  | 'Combat'
  | 'SecondMain'
  | 'End'
  | 'Showdown'
  | 'Scoring'
  | 'GameOver';

export interface CardInstance {
  instanceId: string;
  cardId: string;
  ownerId: string;
  location: 'hand' | 'deck' | 'battlefield' | 'discard' | 'runeDeck' | 'runeDiscard' | 'hidden' | 'equipment';
  battlefieldId?: string;
  ready: boolean;
  exhausted: boolean;
  stats: CardStats;
  currentStats: CardStats;
  counters: Record<string, number>;
  attachments: string[];
  facing: 'up' | 'down';
  owner_hidden: boolean;
}

export interface BattlefieldState {
  id: string;
  name: string;
  cardId: string;
  controllerId: string | null;
  units: string[];
  scoringSince: number | null;
  scoringPlayerId: string | null;
}

export interface PlayerState {
  id: string;
  name: string;
  hand: string[];
  deck: string[];
  runeDeck: string[];
  runeDiscard: string[];
  discardPile: string[];
  score: number;
  xp: number;
  equipment: Record<string, string>;
  hiddenZone: string[];
  isReady: boolean;
  mana: number;
  maxMana: number;
  charges: number;
}

export interface GameState {
  id: string;
  turn: number;
  phase: Phase;
  activePlayerId: string;
  players: Record<string, PlayerState>;
  battlefields: BattlefieldState[];
  allCards: Record<string, CardInstance>;
  cardDefinitions: Record<string, CardDefinition>;
  winner: string | null;
  scoreLimit: number;
  actionLog: GameAction[];
  gameLog: GameLogEntry[];
  createdAt: number;
  isPvP: boolean;
}

// --- Action Types ---

export type ActionType =
  | 'PlayUnit'
  | 'PlaySpell'
  | 'PlayGear'
  | 'EquipGear'
  | 'MoveUnit'
  | 'Attack'
  | 'UseAbility'
  | 'Pass'
  | 'Mulligan'
  | 'DrawRune'
  | 'UseRune'
  | 'HideCard'
  | 'ReactFromHidden'
  | 'AssignBlocker'
  | 'Concede';

export interface GameAction {
  id: string;
  type: ActionType;
  playerId: string;
  payload: Record<string, unknown>;
  turn: number;
  phase: Phase;
  timestamp: number;
}

export interface PlayUnitPayload {
  cardInstanceId: string;
  battlefieldId: string;
  hidden: boolean;
  accelerate: boolean;
}

export interface PlaySpellPayload {
  cardInstanceId: string;
  targetId?: string;
  targetBattlefieldId?: string;
}

export interface PlayGearPayload {
  cardInstanceId: string;
  targetUnitId: string;
}

export interface MoveUnitPayload {
  cardInstanceId: string;
  fromBattlefieldId: string;
  toBattlefieldId: string;
}

export interface AttackPayload {
  attackerId: string;
  targetBattlefieldId: string;
  declaredBlockers?: string[];
}

export interface UseAbilityPayload {
  cardInstanceId: string;
  abilityIndex: number;
  targetId?: string;
  targetBattlefieldId?: string;
}

export interface HideCardPayload {
  cardInstanceId: string;
  costPaid: number;
}

export interface ReactFromHiddenPayload {
  cardInstanceId: string;
  triggerActionId?: string;
}

// --- Game Events (WebSocket) ---

export type GameEventType =
  | 'game_start'
  | 'game_state_update'
  | 'action_result'
  | 'phase_change'
  | 'turn_change'
  | 'game_over'
  | 'opponent_action'
  | 'error'
  | 'chat';

export interface GameEvent {
  type: GameEventType;
  gameId: string;
  data: unknown;
  timestamp: number;
}

export interface GameStartEvent {
  gameId: string;
  playerId: string;
  opponentId: string;
  initialState: GameState;
  yourTurn: boolean;
}

export interface ActionResultEvent {
  success: boolean;
  action: GameAction;
  error?: string;
  newState?: GameState;
}

export interface PhaseChangeEvent {
  phase: Phase;
  turn: number;
  activePlayerId: string;
}

export interface GameOverEvent {
  winnerId: string;
  reason: 'score' | 'concede' | 'timeout';
}

// --- Lobby / Matchmaking ---

export type GameMode = 'casual' | 'ranked' | 'vs_ai';

export interface Lobby {
  id: string;
  hostId: string;
  guestId: string | null;
  gameMode: GameMode;
  hostDeckId: string | null;
  guestDeckId: string | null;
  status: 'waiting' | 'ready' | 'starting';
  createdAt: number;
}

// --- Deck Types ---

export interface Deck {
  id: string;
  playerId: string;
  name: string;
  legendId: string;              // Champion Legend (type=Legend, stays in Legend Zone)
  chosenChampionCardId: string | null;   // Champion unit (type=Champion, goes to Champion Zone at game start)
  cardIds: string[];            // Main deck card ids (39 cards: Units/Spells/Gears — excludes Chosen Champion)
  runeIds: string[];            // Rune deck card ids (12 cards)
  battlefieldIds: string[];      // Battlefield card ids (Mode-dependent; first is starting)
  sideboardIds: string[];        // Sideboard card ids (8 cards)
  createdAt: number;
  updatedAt: number;
}

export interface DeckValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  cardCount: number;
  championCount: number;
  signatureCount: number;
  runeCount: number;
  battlefieldCount: number;
  sideboardCount: number;
}

// --- API Types ---

export interface AuthPayload {
  username: string;
  password: string;
}

export interface MatchSummary {
  id: string;
  players: string[];
  winnerId: string;
  startedAt: number;
  endedAt: number;
  turns: number;
}
