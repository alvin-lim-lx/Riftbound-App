// ============================================================
// Shared Types — Riftbound
// Synced with backend/shared/src/types.ts
// ============================================================

// --- Card Types ---

export type CardType = 'Unit' | 'Spell' | 'Gear' | 'Battlefield' | 'Legend' | 'Rune' | 'Champion' | 'Signature';

export type Domain =
  | 'Chaos' | 'Calm' | 'Fury' | 'Mind' | 'Body' | 'Order' | 'Colorless'
  | 'Demacia' | 'Noxus' | 'Ionia' | 'Shurima' | 'Freljord' | 'Bilgewater' | 'Piltover' | 'Zaun' | 'Shadow Isles' | 'Void' | 'Ixtal' | 'Bandle';

export type Keyword =
  | 'Ambush'
  | 'Assault'
  | 'Backline'
  | 'Banish'
  | 'Buff'
  | 'Deathknell'
  | 'Deflect'
  | 'Equip'
  | 'Ganking'
  | 'Hidden'
  | 'Hunt'
  | 'Accelerate'
  | 'Temporary'
  | 'Legion'
  | 'Legions'
  | 'Level'
  | 'Lifesteal'
  | 'SpellShield'
  | 'Quick'
  | 'Quick-Draw'
  | 'Fearsome'
  | 'Elusive'
  | 'Repeat'
  | 'Action'
  | 'Reaction'
  | 'Recall'
  | 'Shield'
  | 'Stun'
  | 'Recycle'
  | 'Tank'
  | 'Mighty'
  | 'Unique'
  | 'Vision'
  | 'Weaponmaster'
  | 'Predict';

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

// --- Game State Types ---

export type Phase =
  | 'Setup'
  | 'Mulligan'
  | 'Awaken'
  | 'Beginning'
  | 'Channel'
  | 'Draw'
  | 'Action'
  | 'End'
  | 'Showdown'
  | 'Scoring'
  | 'GameOver';

export interface CardInstance {
  instanceId: string;
  cardId: string;
  ownerId: string;
  location: 'hand' | 'deck' | 'battlefield' | 'discard' | 'banishment' | 'runeDeck' | 'runeDiscard' | 'rune' | 'hidden' | 'equipment' | 'legend' | 'championZone';
  battlefieldId?: string;
  ready: boolean;
  exhausted: boolean;
  stats: CardStats;
  currentStats: CardStats;
  damage?: number;
  counters: Record<string, number>;
  attachments: string[];
  facing: 'up' | 'down';
  owner_hidden: boolean;
  hiddenBattlefieldId?: string;
  hiddenSinceTurn?: number;
  playedTurn?: number;
}

export interface KeywordModifier {
  id: string;
  cardInstanceId: string;
  keyword: Keyword;
  value?: number;
  cost?: CardCost;
  dependentText?: string;
  sourceCardInstanceId?: string;
  duration: 'turn' | 'while_attacking' | 'while_defending' | 'permanent';
  expiresTurn?: number;
  visibleTo?: 'all' | 'owner';
}

export interface PendingKeywordChoice {
  id: string;
  playerId: string;
  sourceId: string;
  keyword: Keyword;
  choices: Record<string, unknown>;
}

export interface EffectStackEntry {
  id: string;
  sourceId: string;
  trigger: string;
  effect: string;
  resolves: boolean;
  triggeredBy?: string;
}

export interface ReactionPayload {
  cardInstanceId: string;
  targetId?: string;
  targetBattlefieldId?: string;
}

// Spell targeting
export type SpellTargetType = 'unit' | 'gear';

export interface SpellTargeting {
  needsTarget: boolean;
  targetType: SpellTargetType;
}

export interface ShowdownStackEntry {
  id: string;
  sourceId: string;
  ownerId: string;
  type: 'ability' | 'spell' | 'reaction';
  effect: string;
  resolves: boolean;
}

export interface ShowdownState {
  kind: 'Combat' | 'NonCombat';
  battlefieldId: string;
  attackerIds: string[];
  attackerOwnerId: string;
  attackerPlayerId: string;
  defenderPlayerId: string | null;
  focusPlayerId: string | null;
  defenderIds: string[];
  combatStep: 'Showdown' | 'AssignDamage' | 'Resolution' | null;
  reactionWindowOpen: boolean;
  combatResolved: boolean;
  winner: 'attacker' | 'defender' | 'draw' | null;
  excessDamage: number;
  actionStack: ShowdownStackEntry[];
  passTracker: [boolean, boolean];
  chainOpen: boolean;
}

export type CombatSide = 'attacker' | 'defender';

export interface OrderedCombatDamageAssignment {
  unitId: string;
  damage: number;
}

export interface PendingCombatDamageAssignment {
  battlefieldId: string;
  assigningPlayerId: string;
  sourceSide: CombatSide;
  availableDamage: number;
  legalTargetIds: string[];
  assignments: Partial<Record<CombatSide, Record<string, number>>>;
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
  scoredBattlefieldsThisTurn: Record<string, string[]>;
  actionLog: GameAction[];
  createdAt: number;
  isPvP: boolean;
  showdown?: ShowdownState;
  pendingCombatDamageAssignment?: PendingCombatDamageAssignment | null;
  keywordModifiers?: KeywordModifier[];
  pendingKeywordChoices?: PendingKeywordChoice[];
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
  banishment?: string[];
  isReady: boolean;
  energy: number;
  maxEnergy: number;
  charges: number;
  floatingEnergy: number;
  cardsPlayedThisTurn?: string[];
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
  scoredBattlefieldsThisTurn: Record<string, string[]>;
  actionLog: GameAction[];
  createdAt: number;
  isPvP: boolean;
  showdown?: ShowdownState;
  pendingCombatDamageAssignment?: PendingCombatDamageAssignment | null;
  keywordModifiers?: KeywordModifier[];
  pendingKeywordChoices?: PendingKeywordChoice[];
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
  | 'HideCard'
  | 'ReactFromHidden'
  | 'AssignBlocker'
  | 'Concede'
  | 'Focus'
  | 'Reaction'
  | 'AssignCombatDamage'
  | 'CloseReactionWindow';

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
  fromHidden?: boolean;
  repeatCount?: number;
  repeatTargets?: string[];
  hiddenBattlefieldId?: string;
  equipTargetId?: string;
  predictChoice?: 'keep' | 'recycle';
  powerRuneDomains?: Domain[];
}

export interface PlaySpellPayload {
  cardInstanceId: string;
  targetId?: string;
  targetBattlefieldId?: string;
  fromHidden?: boolean;
  repeatCount?: number;
  repeatTargets?: string[];
  hiddenBattlefieldId?: string;
  equipTargetId?: string;
  predictChoice?: 'keep' | 'recycle';
  powerRuneDomains?: Domain[];
}

export interface PlayGearPayload {
  cardInstanceId: string;
  targetUnitId?: string;
  targetBattlefieldId?: string;
  fromHidden?: boolean;
  repeatCount?: number;
  repeatTargets?: string[];
  hiddenBattlefieldId?: string;
  equipTargetId?: string;
  predictChoice?: 'keep' | 'recycle';
  powerRuneDomains?: Domain[];
}

export interface MoveUnitPayload {
  cardInstanceId?: string;
  cardInstanceIds?: string[];
  fromBattlefieldId?: string;
  toBattlefieldId: string;
}

export interface AttackPayload {
  attackerId: string;
  targetBattlefieldId: string;
  declaredBlockers?: string[];
}

export interface AssignCombatDamagePayload {
  targetOrder: string[];
}

export interface UseAbilityPayload {
  cardInstanceId: string;
  abilityIndex: number;
  targetId?: string;
  targetBattlefieldId?: string;
}

export interface HideCardPayload {
  cardInstanceId: string;
  battlefieldId?: string;
  hideRuneDomain?: Domain;
  costPaid?: number;
}

export interface ReactFromHiddenPayload {
  cardInstanceId: string;
  triggerActionId?: string;
}

// --- Game Events (WebSocket) ---

export type LogEntryType =
  | 'PhaseChange' | 'TurnChange' | 'Score' | 'GameStart' | 'GameOver'
  | 'System' | 'Showdown' | 'Combat' | 'Focus'
  | 'Mulligan'
  | 'Channel'
  | 'Draw'
  | 'Move'
  | 'Hide'
  | 'ReactFromHidden'
  | 'Equip';

export interface SystemLogEntry {
  id: string;
  type: LogEntryType;
  playerId?: string;
  message: string;
  turn: number;
  phase: Phase;
  timestamp: number;
  detail?: Record<string, unknown>;
}

export type GameLogEntry = GameAction | SystemLogEntry;

export interface PublicGameLogEntry {
  id: string;
  type: LogEntryType | ActionType;
  message: string;
  turn: number;
  phase: Phase;
  timestamp: number;
}

export type GameEventType =
  | 'game_start'
  | 'game_state_update'
  | 'game_log'
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
  initialLog?: PublicGameLogEntry[];
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

export interface GameLogEvent {
  gameId: string;
  entries: PublicGameLogEntry[];  // incremental viewer-safe log entries since last broadcast
  timestamp: number;
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
