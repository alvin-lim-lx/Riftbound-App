// ============================================================
// Shared Types — Riftbound
// Used by both backend and frontend
// ============================================================

// --- Card Types ---

export type CardType = 'Unit' | 'Spell' | 'Gear' | 'Battlefield' | 'Legend' | 'Rune' | 'Champion' | 'Signature';

export type Domain =
  // Riftbound domains (card gallery website)
  | 'Chaos' | 'Calm' | 'Fury' | 'Mind' | 'Body' | 'Order' | 'Colorless'
  // League of Legends regions (for cross-compatibility)
  | 'Demacia' | 'Noxus' | 'Ionia' | 'Shurima' | 'Freljord' | 'Bilgewater' | 'Piltover' | 'Zaun' | 'Shadow Isles' | 'Void' | 'Ixtal' | 'Bandle';

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
  | 'Equip'
  | 'Recall'
  | 'Shield'
  | 'Buff'
  | 'Stun'
  | 'Banish'
  | 'Recycle'
  | 'Tank'
  | 'Mighty'
  | 'Weaponmaster'
  | 'Predict';

export interface CardCost {
  rune: number;    // Rune resource (C)
  power?: number;   // Charge resource (A) for reactions/special costs
  charges?: number; // Charge cost for Hidden reactions
}

export interface CardStats {
  might?: number;  // Combat strength
}

export interface Ability {
  trigger: string;   // e.g., "When you play me", "When I conquer"
  effect: string;     // Human-readable effect description
  effectCode?: string; // Machine-parseable effect for engine
}

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  superType?: 'Champion' | 'Signature' | 'Token' | 'Basic';
  cost?: CardCost;
  domains?: Domain[];
  keywords?: Keyword[];
  stats?: CardStats;
  effect?: string;         // Human-readable effect description (flat string, all abilities concatenated)
  effectCode?: string;    // Machine-parseable effect for engine
  abilities?: Ability[];
  set: string;
  rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary';
  championName?: string;  // e.g. "Kai'sa" for Legend cards — display as "Kai'sa, Daughter of the Void"
  tags?: string[];         // e.g. ["Ahri", "Ionia"] for Champion/Signature units; ["Mech", "Piltover"] for others
  imageUrl?: string;
  flavorText?: string;
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
  instanceId: string;  // Unique per-card instance ID
  cardId: string;       // References CardDefinition.id
  ownerId: string;
  location: 'hand' | 'deck' | 'battlefield' | 'discard' | 'runeDeck' | 'runeDiscard' | 'hidden' | 'equipment' | 'legend' | 'championZone';
  battlefieldId?: string;
  ready: boolean;
  exhausted: boolean;   // Tapped / used this turn
  stats: CardStats;
  currentStats: CardStats; // Mutable during game (buffed/damaged)
  counters: Record<string, number>; // Various counters
  attachments: string[]; // Gear instanceIds attached
  facing: 'up' | 'down'; // Hidden cards
  owner_hidden: boolean; // Opponent can't see this card
}

export interface BattlefieldState {
  id: string;
  name: string;
  cardId: string; // Which Battlefield card this is
  controllerId: string | null;
  units: string[];  // CardInstance.instanceId
  scoringSince: number | null;  // Turn number when scoring started
  scoringPlayerId: string | null;
}

export interface PlayerState {
  id: string;
  name: string;
  hand: string[];      // CardInstance.instanceId
  deck: string[];       // CardInstance.instanceId
  runeDeck: string[];   // CardInstance.instanceId
  runeDiscard: string[];
  discardPile: string[];
  score: number;
  xp: number;
  equipment: Record<string, string>; // gearInstanceId → unitInstanceId
  hiddenZone: string[];  // Hidden cards instanceIds
  isReady: boolean;
  mana: number;    // Current rune resource available
  maxMana: number; // Max rune resource this turn
  charges: number;  // Current charge resource
  legend: string | null;        // CardInstance.instanceId of Champion Legend (Legend Zone)
  chosenChampion: string | null; // CardInstance.instanceId of Chosen Champion (Champion Zone)
  hasGoneFirst: boolean;         // Tracks who went first (for first-turn asymmetry)
  mulligansComplete: boolean;    // Both players done with mulligan
}

export interface GameState {
  id: string;
  turn: number;
  phase: Phase;
  activePlayerId: string;
  players: Record<string, PlayerState>;  // keyed by playerId
  battlefields: BattlefieldState[];
  allCards: Record<string, CardInstance>;  // all card instances by instanceId
  cardDefinitions: Record<string, CardDefinition>;  // cached card data
  winner: string | null;
  scoreLimit: number;
  actionLog: GameAction[];
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

// Specific action payloads
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
  declaredBlockers?: string[];  // defender's unit instanceIds
}

export interface UseAbilityPayload {
  cardInstanceId: string;
  abilityIndex: number;
  targetId?: string;
  targetBattlefieldId?: string;
}

export interface HideCardPayload {
  cardInstanceId: string;
  costPaid: number; // charges spent
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
  legendId: string;              // Champion Legend card id (type=Legend, stays in Legend Zone)
  chosenChampionCardId: string | null; // Champion unit card id (type=Champion, goes to Champion Zone at game start)
  cardIds: string[];             // Main deck card ids (39 cards: Units/Spells/Gears — excludes Chosen Champion)
  runeIds: string[];             // Rune deck card ids (12 cards)
  battlefieldIds: string[];       // Battlefield card ids (Mode-dependent; first is starting)
  sideboardIds: string[];         // Sideboard card ids (8 cards)
  isAiDeck?: boolean;             // If true, this is an AI pre-built deck usable by the AI opponent
  createdAt: number;
  updatedAt: number;
}

export interface DeckValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  cardCount: number;         // main deck card count
  championCount: number;    // Chosen Champion copies (same named Champion unit matching legend tag)
  signatureCount: number;   // number of Signature cards in main deck
  runeCount: number;
  battlefieldCount: number;
  sideboardCount: number;
}

// --- User / Auth Types ---

export interface User {
  id: string;
  username: string;
  createdAt: number;
}

export interface AuthResponse {
  user: User;
  token: string;
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
