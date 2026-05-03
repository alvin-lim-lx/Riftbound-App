/**
 * BoardLayout — NEW Riftbound game board (Horizontal format)
 *
 * Layout (CSS FlexColumn):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ TOP BAR: [Opponent Info + Runes] | Turn Tracker | [Player Info + Runes] │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ Row 1: Opponent Graveyard | Opponent Hand | Opponent Main Deck    │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ Row 2: Opponent Base | Opponent Legend | Opponent Champion        │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ Row 3: BATTLEFIELDS (flex-grow, center stage)                     │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ Row 4: Player Base | Player Legend | Player Champion              │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ Row 5: Player Main Deck | Player Hand | Player Graveyard          │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Card sizing:
 *   sm = 64×86 (was 44×58)  — graveyard, deck
 *   md = 100×134 (was 64×86) — hand, base/champ/legend
 *   lg = 140×188 (was 100×134) — battlefield units
 */

import React, { useCallback } from 'react';
import { useGameStore, type PlayerWarning } from '../../store/gameStore';
import { gameService } from '../../services/gameService';
import { ActionBar } from './ActionBar';
import { CardModal } from './CardModal';
import { PhaseIndicator, getPhaseLabel, getTurnPrompt } from './PhaseIndicator';
import { GameLog } from './GameLog';
import { ChatBox } from './ChatBox';
import { MulliganOverlay } from './MulliganOverlay';
import { CardArtView } from './CardArtView';
import { SpellTargetingModal, PendingSpell } from './SpellTargetingModal';
import { DiscardPileModal } from './DiscardPileModal';
import { PowerRuneSelectionModal } from './PowerRuneSelectionModal';
import type { GameAction, GameState, PlayerState, CardInstance, CardDefinition, Phase, Domain, BattlefieldState, SpellTargetType, SpellTargeting } from '../../shared/types';
import { CARDS } from '../../shared/cards';
import { randomId } from '../../utils/helpers';
import bodyRuneIcon from '../../assets/runes/Body Rune.png';
import calmRuneIcon from '../../assets/runes/Calm Rune.png';
import chaosRuneIcon from '../../assets/runes/Chaos Rune.png';
import furyRuneIcon from '../../assets/runes/Fury Rune.png';
import mindRuneIcon from '../../assets/runes/Mind Rune.png';
import orderRuneIcon from '../../assets/runes/Order Rune.png';

const CARD_HEIGHTS = {
  stackMin: 64,
  stackMax: 122,
  opponentStackMax: 108,
  narrowStackMax: 62,
  narrowHandMin: 84,
  narrowHandMax: 90,
  handMin: 112,
  handMax: 148,
  handShortMax: 124,
  zoneMin: 86,
  zoneMax: 160,
  opponentZoneMax: 154,
  battlefieldMin: 96,
  battlefieldMax: 132,
};

function fitCardHeight(available: number, min: number, max: number): number {
  if (!Number.isFinite(available) || available <= 0) return min;
  return Math.round(Math.min(max, Math.max(min, available)));
}

function useBoardViewport() {
  const getViewport = () => ({
    width: typeof window === 'undefined' ? 1200 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  });
  const [viewport, setViewport] = React.useState(getViewport);

  React.useEffect(() => {
    const handleResize = () => setViewport(getViewport());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    width: viewport.width,
    height: viewport.height,
    isNarrow: viewport.width < 900,
    isLaptop: viewport.width >= 900 && viewport.width < 1280,
    isShort: viewport.height < 780,
  };
}

// ─────────────────────────────────────────
// Domain → color mapping for rune icons
// ─────────────────────────────────────────
const DOMAIN_COLORS: Record<string, string> = {
  Fury:    '#e63946',
  Calm:    '#60a5fa',
  Chaos:   '#f59e0b',
  Mind:    '#a78bfa',
  Body:    '#10b981',
  Order:   '#3b82f6',
  Colorless: '#9ca3af',
};

function runeColor(def: CardDefinition | undefined): string {
  if (!def?.domains?.length) return '#9ca3af';
  return DOMAIN_COLORS[def.domains[0]] ?? '#9ca3af';
}

const RUNE_ICONS: Partial<Record<Domain, string>> = {
  Body: bodyRuneIcon,
  Calm: calmRuneIcon,
  Chaos: chaosRuneIcon,
  Fury: furyRuneIcon,
  Mind: mindRuneIcon,
  Order: orderRuneIcon,
};

function runeDomain(def: CardDefinition | undefined): Domain | undefined {
  return def?.domains?.find(domain => RUNE_ICONS[domain]);
}

function cardHasKeyword(def: CardDefinition | undefined, keyword: string): boolean {
  return (def?.keywords ?? []).some(kw => kw.toLowerCase() === keyword.toLowerCase());
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

const BASE_BATTLEFIELD_PREFIX = 'base_';

function getBaseBattlefieldId(playerId: string): string {
  return `${BASE_BATTLEFIELD_PREFIX}${playerId}`;
}

function isBaseBattlefieldId(id: string): boolean {
  return id.startsWith(BASE_BATTLEFIELD_PREFIX);
}

function getBattlefieldLabel(battlefield: BattlefieldState | undefined, playerId: string): string {
  if (!battlefield) return 'Unknown location';
  if (battlefield.id === getBaseBattlefieldId(playerId)) return 'Your Base';
  if (isBaseBattlefieldId(battlefield.id)) return 'Enemy Base';
  return battlefield.name;
}

function getAvailableRunes(player: PlayerState | undefined, allCards: Record<string, CardInstance>): number {
  if (!player) return 0;
  const readyRunes = Object.values(allCards).filter(card =>
    card.ownerId === player.id && card.location === 'rune' && !card.exhausted
  ).length;
  return readyRunes + (player.floatingEnergy ?? 0);
}

function getActiveRuneDomains(player: PlayerState | undefined, allCards: Record<string, CardInstance>, cardDefs: Record<string, CardDefinition>): Domain[] {
  if (!player) return [];
  const domains = new Set<Domain>();
  for (const card of Object.values(allCards)) {
    if (card.ownerId !== player.id || card.location !== 'rune') continue;
    const domain = runeDomain(cardDefs[card.cardId]);
    if (domain) domains.add(domain);
  }
  return Array.from(domains);
}

interface PendingPlayAction {
  actionType: 'PlayUnit' | 'PlayGear' | 'PlaySpell';
  payload: Record<string, unknown>;
  cardName: string;
  cardType: string;
  destinationLabel?: string; // not used for spells
  runeCost?: number; // not used for spells
  availableRunes?: number; // not used for spells
  powerCost?: number;
  powerDomains?: Domain[];
  targetType?: SpellTargetType; // only for spells
  selectedTargetIds?: string[]; // only for spells
  hasAccelerate?: boolean; // card has Accelerate keyword
  accelerateDomain?: Domain; // domain required for accelerate cost
}

interface PendingMoveUnit {
  unitId: string;
  unitName: string;
  originBattlefieldId: string;
  originLabel: string;
}

interface PendingMoveAction {
  destinationBattlefieldId: string;
  destinationLabel: string;
  units: PendingMoveUnit[];
}

function getPlayerCards(
  player: PlayerState | undefined,
  allCards: Record<string, CardInstance>,
  location: string
): CardInstance[] {
  if (!player) return [];
  return Object.values(allCards).filter(
    c => c.ownerId === player.id && c.location === location
  );
}

function partitionPlayerZones(
  playerId: string,
  allCards: Record<string, CardInstance>,
  cardDefs: Record<string, CardDefinition>
): { baseIds: string[]; championIds: string[]; legendIds: string[] } {
  const baseIds: string[] = [];
  const championIds: string[] = [];
  const legendIds: string[] = [];

  for (const c of Object.values(allCards)) {
    if (c.ownerId !== playerId) continue;
    const def = cardDefs[c.cardId];
    if (!def) continue;

    const location = c.location as string;
    if (location === 'battlefield' && def.type === 'Battlefield') baseIds.push(c.instanceId);
    else if (location === 'championZone' && def.type === 'Unit' && def.superType === 'Champion') championIds.push(c.instanceId);
    else if (location === 'legend' && def.type === 'Legend') legendIds.push(c.instanceId);
  }

  return { baseIds, championIds, legendIds };
}

// ─────────────────────────────────────────
// CardStack — shows N cards in a small stack (for deck/graveyard)
// ─────────────────────────────────────────
interface CardStackProps {
  count: number;
  label: string;
  topCard?: CardInstance;
  cardDef?: CardDefinition | null;
  accentColor: string;
  isPlayer: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
  hidden?: boolean; // true = show card back (for hidden decks)
  maxHeightPx?: number;
}

function CardStack({ count, label, topCard, cardDef, accentColor, isPlayer, onClick, size = 'md', hidden, maxHeightPx }: CardStackProps) {
  const baseDims = size === 'sm' ? { w: 64, h: 86 } : { w: 80, h: 108 };
  const dims = maxHeightPx ? { w: Math.round(baseDims.w * (maxHeightPx / baseDims.h)), h: maxHeightPx } : baseDims;
  const stackColors = ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.12)'];

  return (
    <div style={stackStyles.container} onClick={onClick}>
      <div style={stackStyles.label}>{label}</div>
      <div style={{ ...stackStyles.stack, width: dims.w, height: dims.h }}>
        {/* Stack effect: 3 offset cards behind */}
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              background: stackColors[i],
              border: `1px solid ${accentColor}33`,
              borderRadius: '8px',
              transform: `translateY(${i * -1}px) translateX(${i * 0.5}px)`,
              zIndex: i,
            }}
          />
        ))}
        {/* Top card — hidden for face-down decks, otherwise shown */}
        {hidden ? (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)',
            border: `1px solid ${accentColor}66`,
            borderRadius: '8px',
            zIndex: 10,
          }}>
            <span style={{ color: accentColor + '99', fontSize: '20px', fontWeight: 800 }}>?</span>
          </div>
        ) : topCard && cardDef ? (
          <CardArtView
            card={topCard}
            cardDef={cardDef}
            isOpponent={!isPlayer}
            showStats={true}
            showKeywords={false}
            size={size === 'sm' ? 'sm' : 'md'}
            maxHeight={maxHeightPx}
            forceReady={topCard.location === 'discard'}
          />
        ) : (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            border: `1px dashed ${accentColor}44`,
            borderRadius: '8px',
          }}>
            <span style={{ color: accentColor + '60', fontSize: '24px' }}>—</span>
          </div>
        )}
      </div>
      <div style={{ ...stackStyles.count, color: accentColor + 'cc' }}>{count}</div>
    </div>
  );
}

const stackStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    flexShrink: 1,
    minHeight: 0,
  },
  label: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    color: '#888',
    fontWeight: 700,
  },
  stack: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontSize: '13px',
    fontWeight: 800,
  },
};

// ─────────────────────────────────────────
// ActiveRunesDisplay — row of rune icons, colored by domain, greyed if exhausted
// ─────────────────────────────────────────
interface ActiveRunesDisplayProps {
  runeIds: string[];
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  isPlayer: boolean;
}

function ActiveRunesDisplay({ runeIds, allCards, cardDefs, isPlayer }: ActiveRunesDisplayProps) {
  const runes = runeIds.map(id => allCards[id]).filter(Boolean);
  if (runes.length === 0) {
    return <span style={{ color: '#555', fontSize: '11px', fontStyle: 'italic' }}>No active runes</span>;
  }

  return (
    <div style={runeStyles.container}>
      {runes.map(rune => {
        const def = cardDefs[rune.cardId];
        const domain = runeDomain(def);
        const icon = domain ? RUNE_ICONS[domain] : undefined;
        const color = runeColor(def);
        const exhausted = rune.exhausted;
        return (
          <div
            key={rune.instanceId}
            style={{
              ...runeStyles.rune,
              background: exhausted ? 'rgba(100,100,100,0.2)' : color + '22',
              border: `1.5px solid ${exhausted ? '#555' : color}`,
              color: exhausted ? '#555' : color,
              opacity: exhausted ? 0.5 : 1,
            }}
            title={`${def?.name ?? 'Rune'} ${exhausted ? '(exhausted)' : '(active)'}`}
          >
            {icon ? (
              <img
                src={icon}
                alt={def?.name ?? 'Rune'}
                style={{
                  ...runeStyles.icon,
                  filter: exhausted ? 'grayscale(1) brightness(0.55)' : 'none',
                }}
              />
            ) : (
              <span>◆</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const runeStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  rune: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 900,
    flexShrink: 0,
    transition: 'all 0.2s ease',
    overflow: 'hidden',
    backgroundClip: 'padding-box',
  },
  icon: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: '50%',
    display: 'block',
  },
};

// ─────────────────────────────────────────
// PlayerInfoBar — player name, score, mana, active runes (used in top bar)
// ─────────────────────────────────────────
interface PlayerInfoBarProps {
  player: PlayerState | undefined;
  isPlayer: boolean;          // true = actual player (left side), false = opponent
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  reversed?: boolean;        // flip layout horizontally (for opponent panel)
  compact?: boolean;
}

interface PendingHideRuneSelection {
  cardInstanceId: string;
  battlefieldId: string;
  cardName: string;
}

function PlayerInfoBar({ player, isPlayer, allCards, cardDefs, reversed, compact = false }: PlayerInfoBarProps) {
  if (!player) return <div style={infoBarStyles.placeholder} />;

  const isYou = isPlayer;
  // Rune pool = cards with location 'rune'
  const activeRuneIds = Object.values(allCards)
    .filter(c => c.ownerId === player.id && (c.location as string) === 'rune')
    .map(c => c.instanceId);

  const accentColor = isYou ? '#22c55e' : '#ef4444';

  return (
    <div style={{
      ...infoBarStyles.bar,
      ...(compact ? infoBarStyles.barCompact : {}),
      borderColor: accentColor + '44',
      background: accentColor + '0d',
    }}>
      {/* Name + XP + score — evenly spaced across the full width */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        {reversed ? (
          <>
            {/* Opponent: score left, xp center, name right */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '4px', flex: 1 }}>
              <span style={infoBarStyles.star}>★</span>
              <span style={{ ...infoBarStyles.scoreNum, color: '#d4a843', fontSize: compact ? '32px' : '42px', lineHeight: 1 }}>{player.score}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', flex: 1 }}>
              <div style={infoBarStyles.resource}>
                <span style={infoBarStyles.xpIcon}>✦</span>
                <span style={infoBarStyles.xpVal}>{player.xp} XP</span>
              </div>
            </div>
            <div style={{ ...infoBarStyles.name, color: '#ccc', textAlign: 'right', flex: 1 }}>{player.name}</div>
          </>
        ) : (
          <>
            {/* Player: name left, xp center, score right */}
            <div style={{ ...infoBarStyles.name, color: '#e8e8e8', textAlign: 'left', flex: 1 }}>
              {player.name}
              <span style={infoBarStyles.youTag}> (You)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', flex: 1 }}>
              <div style={infoBarStyles.resource}>
                <span style={infoBarStyles.xpIcon}>✦</span>
                <span style={infoBarStyles.xpVal}>{player.xp} XP</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', flex: 1 }}>
              <span style={infoBarStyles.star}>★</span>
              <span style={{ ...infoBarStyles.scoreNum, color: '#d4a843', fontSize: compact ? '32px' : '42px', lineHeight: 1 }}>{player.score}</span>
            </div>
          </>
        )}
      </div>

      {/* Active runes */}
      <div style={{ ...infoBarStyles.runesSection, flexDirection: reversed ? 'row-reverse' : 'row' }}>
        <ActiveRunesDisplay
          runeIds={activeRuneIds}
          allCards={allCards}
          cardDefs={cardDefs}
          isPlayer={isYou}
        />
        {(player.floatingEnergy ?? 0) > 0 && (
          <span style={infoBarStyles.floatingEnergy} title="Floating energy clears at end of turn">
            +{player.floatingEnergy}
          </span>
        )}
      </div>
    </div>
  );
}

const infoBarStyles: Record<string, React.CSSProperties> = {
  placeholder: { flex: 1, minWidth: '200px' },
  bar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '6px 12px',
    borderRadius: '10px',
    border: '1px solid',
    flex: 1,
    minWidth: '200px',
    maxWidth: '320px',
  },
  barCompact: {
    minWidth: 0,
    maxWidth: 'none',
    width: '100%',
    padding: '6px 8px',
    borderRadius: '8px',
    overflow: 'hidden',
  },

  name: {
    fontSize: '13px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  youTag: {
    fontSize: '10px',
    fontWeight: 400,
    color: '#22c55e',
  },
  star: {
    fontSize: '11px',
    color: '#d4a843',
  },
  scoreNum: {
    fontSize: '16px',
    fontWeight: 900,
    lineHeight: 1,
  },
  resources: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  resource: {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
  },
  xpIcon: {
    fontSize: '9px',
    color: '#d4a843',
  },
  xpVal: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#d4a843',
  },
  runesSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '2px',
  },
  floatingEnergy: {
    minWidth: '20px',
    height: '20px',
    padding: '0 5px',
    borderRadius: '10px',
    border: '1px solid rgba(96,165,250,0.55)',
    background: 'rgba(96,165,250,0.14)',
    color: '#bfdbfe',
    fontSize: '11px',
    fontWeight: 800,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

// ─────────────────────────────────────────
// OpponentHandRow — card backs (hidden) or count
// ─────────────────────────────────────────
interface OpponentHandRowProps {
  count: number;
}

function OpponentHandRow({ count }: OpponentHandRowProps) {
  return (
    <div style={handStyles.opponentContainer}>
      <div style={handStyles.zoneLabel}>HAND</div>
      <div style={handStyles.opponentCards}>
        {count > 0 ? (
          Array.from({ length: Math.min(count, 10) }).map((_, i) => (
            <div key={i} style={handStyles.cardBack}>?</div>
          ))
        ) : (
          <span style={handStyles.empty}>—</span>
        )}
      </div>
      <div style={handStyles.countBadge}>{count}</div>
    </div>
  );
}

// ─────────────────────────────────────────
// PlayerHandRow — fan of visible cards
// ─────────────────────────────────────────
interface PlayerHandRowProps {
  cards: CardInstance[];
  cardDefs: Record<string, CardDefinition>;
  legionActiveCardIds?: string[];
  onCardClick?: (instanceId: string) => void;
  pendingSpell?: PendingSpell | null;
  onSpellCardClick?: (instanceId: string) => void;
  pendingHideCardId?: string | null;
  onHideCardClick?: (instanceId: string) => void;
  canInteract?: boolean;
  maxCardHeight?: number;
}

function PlayerHandRow({ cards, cardDefs, legionActiveCardIds, onCardClick, pendingSpell, onSpellCardClick, pendingHideCardId, onHideCardClick, canInteract = false, maxCardHeight = CARD_HEIGHTS.handMax }: PlayerHandRowProps) {
  const handleClick = (instanceId: string) => {
    const card = cards.find(c => c.instanceId === instanceId);
    const def = card ? cardDefs[card.cardId] : undefined;

    if (def && pendingSpell && onSpellCardClick) {
      // During spell targeting, only allow clicking the pending spell card to cancel
      if (instanceId === pendingSpell.cardInstanceId) {
        onSpellCardClick(instanceId);
        return;
      }
      return;
    }
    if (def && onSpellCardClick && canInteract && (def.type === 'Spell' || def.type === 'Gear')) {
      onSpellCardClick(instanceId);
    } else {
      onCardClick?.(instanceId);
    }
  };
  if (cards.length === 0) {
    return (
      <div style={handStyles.playerContainer}>
        <div style={handStyles.zoneLabel}>YOUR HAND</div>
        <span style={handStyles.emptyText}>No cards in hand</span>
      </div>
    );
  }

  return (
    <div style={handStyles.playerContainer}>
      <div style={handStyles.zoneLabel}>YOUR HAND</div>
      <div style={handStyles.playerCards}>
        {cards.map((card, i) => {
          const def = cardDefs[card.cardId];
          const canDrag = canInteract && (def?.type === 'Unit' || def?.type === 'Gear');
          const canHide = canInteract && cardHasKeyword(def, 'Hidden');
          const isPendingHide = pendingHideCardId === card.instanceId;

          return (
            <div
              key={card.instanceId}
              draggable={canDrag}
              style={{
                transform: 'none',
                zIndex: i,
                transition: 'transform 0.2s ease',
                flexShrink: 1,
                position: 'relative',
                cursor: canDrag ? 'grab' : 'default',
                outline: isPendingHide ? '2px solid rgba(251,191,36,0.95)' : 'none',
                outlineOffset: '3px',
              }}
              onDragStart={e => {
                if (!canDrag) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', card.instanceId);
                e.dataTransfer.setData('application/riftbound-card', card.instanceId);
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-12px) scale(1.04)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'none';
              }}
            >
              {canDrag && <div style={handStyles.playableBadge}>Drag to play</div>}
              {canHide && (
                <button
                  type="button"
                  style={{
                    ...handStyles.hideButton,
                    ...(isPendingHide ? handStyles.hideButtonActive : {}),
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    onHideCardClick?.(card.instanceId);
                  }}
                  title={isPendingHide ? 'Cancel hide selection' : 'Hide this card'}
                >
                  {isPendingHide ? 'Hiding' : 'Hide'}
                </button>
              )}
              <CardArtView
                card={card}
                cardDef={def}
                isOpponent={false}
                showStats={true}
                showKeywords={true}
                size="md"
                maxHeight={maxCardHeight}
                isLegionActive={legionActiveCardIds?.includes(card.instanceId) ?? false}
                onClick={() => handleClick(card.instanceId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const handStyles: Record<string, React.CSSProperties> = {
  opponentContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    minWidth: '160px',
    flexShrink: 1,
    minHeight: 0,
    flex: 1,
  },
  playerContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    minWidth: '200px',
    flexShrink: 1,
    minHeight: 0,
    flex: 1,
  },
  zoneLabel: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#666',
    fontWeight: 700,
  },
  opponentCards: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'nowrap',
    justifyContent: 'center',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  cardBack: {
    width: '40px',
    height: '54px',
    background: 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '5px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    color: 'rgba(255,255,255,0.2)',
    fontWeight: 800,
    flexShrink: 0,
  },
  playerCards: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '8px 8px 0',
    flexShrink: 1,
    minHeight: 0,
  },
  playableBadge: {
    position: 'absolute',
    top: '-16px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 20,
    padding: '2px 7px',
    borderRadius: '999px',
    background: 'rgba(34,197,94,0.9)',
    color: '#052e16',
    fontSize: '9px',
    fontWeight: 900,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  hideButton: {
    position: 'absolute',
    right: '4px',
    bottom: '4px',
    zIndex: 21,
    border: '1px solid rgba(251,191,36,0.55)',
    borderRadius: '6px',
    background: 'rgba(15,23,42,0.92)',
    color: '#fde68a',
    fontSize: '10px',
    fontWeight: 900,
    padding: '4px 7px',
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(0,0,0,0.24)',
  },
  hideButtonActive: {
    background: '#f59e0b',
    color: '#111827',
    borderColor: '#fbbf24',
  },
  countBadge: {
    fontSize: '12px',
    fontWeight: 800,
    color: '#ef4444',
    background: 'rgba(239,68,68,0.15)',
    borderRadius: '10px',
    padding: '1px 8px',
  },
  empty: {
    color: '#555',
    fontSize: '12px',
    fontStyle: 'italic',
    padding: '4px 8px',
    flexShrink: 1,
    minHeight: 0,
  },
  emptyText: {
    color: '#555',
    fontSize: '12px',
    fontStyle: 'italic',
  },
};

// ─────────────────────────────────────────
// ZoneCard — renders a single card in a zone (base/champ/legend)
// ─────────────────────────────────────────
// ZoneCard — renders a single card in a zone (base/champ/legend)
// maxHeightPx: measured available height for the card
interface ZoneCardProps {
  cardId: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  legionActiveCardIds?: string[];
  isOpponent: boolean;
  size?: 'sm' | 'md' | 'lg';
  maxHeightPx?: number;
  canDragMove?: boolean;
  isPendingMove?: boolean;
  onMoveDragStart?: (cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => void;
}

function ZoneCard({ cardId, allCards, cardDefs, legionActiveCardIds, isOpponent, size = 'md', maxHeightPx, canDragMove = false, isPendingMove = false, onMoveDragStart }: ZoneCardProps) {
  const card = allCards[cardId];
  if (!card) return null;
  const def = cardDefs[card.cardId];

  return (
    <div
      draggable={canDragMove}
      onDragStart={e => {
        if (!canDragMove) return;
        onMoveDragStart?.(card.instanceId, e);
      }}
      style={{
        flexShrink: 0,
        minWidth: 0,
        overflow: 'visible',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: canDragMove ? 'grab' : 'default',
        outline: isPendingMove ? '2px solid rgba(251,191,36,0.8)' : 'none',
        outlineOffset: '3px',
        borderRadius: '8px',
        opacity: isPendingMove ? 0.72 : 1,
      }}
    >
      <CardArtView
        card={card}
        cardDef={def}
        isOpponent={isOpponent}
        showStats={false}
        showKeywords={false}
        size={size}
        maxHeight={maxHeightPx}
        isLegionActive={legionActiveCardIds?.includes(card.instanceId) ?? false}
      />
    </div>
  );
}

// ─────────────────────────────────────────
// ZoneRow — Base | Legend | Champion for one player
// ─────────────────────────────────────────
interface ZoneRowProps {
  player: PlayerState | undefined;
  playerId: string;
  isOpponent: boolean;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  legionActiveCardIds?: string[];
  battlefields?: BattlefieldState[];
  canMoveUnits?: boolean;
  pendingMoveUnitIds?: Set<string>;
  pendingMoveDestinationId?: string | null;
  isNarrow?: boolean;
  onBaseDrop?: (cardInstanceId: string, baseBattlefieldId: string) => void;
  onMoveDrop?: (cardInstanceId: string, destinationBattlefieldId: string) => void;
  onMoveDragStart?: (cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => void;
}

function ZoneRow({ player, playerId, isOpponent, allCards, cardDefs, legionActiveCardIds, battlefields, canMoveUnits = false, pendingMoveUnitIds, pendingMoveDestinationId, isNarrow = false, onBaseDrop, onMoveDrop, onMoveDragStart }: ZoneRowProps) {
  if (!player) return null;

  const rowRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLDivElement>(null);
  const legendRef = React.useRef<HTMLDivElement>(null);
  const champRef = React.useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = React.useState(CARD_HEIGHTS.zoneMin);
  const [baseH, setBaseH] = React.useState(CARD_HEIGHTS.zoneMin);
  const [legendH, setLegendH] = React.useState(CARD_HEIGHTS.zoneMin);
  const [champH, setChampH] = React.useState(CARD_HEIGHTS.zoneMin);

  React.useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const id = entry.target === baseRef.current ? 'base'
          : entry.target === legendRef.current ? 'legend'
          : 'champ';
        const h = entry.contentRect.height;
        if (entry.target === rowRef.current) setRowH(h);
        else if (id === 'base') setBaseH(h);
        else if (id === 'legend') setLegendH(h);
        else setChampH(h);
      }
    });
    if (rowRef.current) observer.observe(rowRef.current);
    if (baseRef.current) observer.observe(baseRef.current);
    if (legendRef.current) observer.observe(legendRef.current);
    if (champRef.current) observer.observe(champRef.current);
    // Fire immediately with current sizes
    if (rowRef.current) setRowH(rowRef.current.clientHeight);
    if (baseRef.current) setBaseH(baseRef.current.clientHeight);
    if (legendRef.current) setLegendH(legendRef.current.clientHeight);
    if (champRef.current) setChampH(champRef.current.clientHeight);
    return () => observer.disconnect();
  }, []);

  const { baseIds, championIds, legendIds } = partitionPlayerZones(
    playerId, allCards, cardDefs
  );
  const baseBattlefield = battlefields?.find(bf => bf.id === getBaseBattlefieldId(playerId));
  const baseUnitIds = baseBattlefield?.units ?? [];
  const baseGearIds = baseBattlefield
    ? Object.values(allCards)
      .filter(card =>
        card.ownerId === playerId &&
        card.location === 'battlefield' &&
        card.battlefieldId === baseBattlefield.id &&
        cardDefs[card.cardId]?.type === 'Gear'
      )
      .map(card => card.instanceId)
    : [];
  const baseContentIds = [...baseIds, ...baseUnitIds, ...baseGearIds];
  const baseUnits = baseUnitIds.map(id => allCards[id]).filter(Boolean);
  const baseSummary = unitSummaryText(baseUnits);

  const accentColor = isOpponent ? '#ef4444' : '#22c55e';
  const labelColor = isOpponent ? '#ef444488' : '#22c55e88';
  const borderColor = isOpponent ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';
  const bg = isOpponent ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)';
  const maxZoneCardH = isOpponent ? CARD_HEIGHTS.opponentZoneMax : CARD_HEIGHTS.zoneMax;
  const rowCardH = fitCardHeight(rowH - 24, CARD_HEIGHTS.zoneMin, maxZoneCardH);
  const baseCardH = fitCardHeight(Math.max(baseH, rowCardH) - 2, CARD_HEIGHTS.zoneMin, maxZoneCardH);
  const legendCardH = fitCardHeight(Math.max(legendH, rowCardH) - 2, CARD_HEIGHTS.zoneMin, maxZoneCardH);
  const champCardH = fitCardHeight(Math.max(champH, rowCardH) - 2, CARD_HEIGHTS.zoneMin, maxZoneCardH);
  const portraitAspect = 744 / 1039;
  const sideZoneCardW = Math.ceil(Math.max(legendCardH, champCardH) * portraitAspect);
  const sideZonesStyle = {
    ...zoneRowStyles.sideZones,
    minWidth: `${(sideZoneCardW * 2) + 16}px`,
  };

  return (
    <div ref={rowRef} style={{
      ...zoneRowStyles.row,
      background: bg,
      borderColor: borderColor,
    }}>
      {/* Base — left-aligned */}
      <div style={zoneRowStyles.zone}>
        <div style={zoneRowStyles.zoneHeader}>
          <span style={{ ...zoneRowStyles.zoneLabel, color: '#7c3aed88' }}>BASE</span>
          {baseUnits.length > 0 && <span style={zoneRowStyles.unitSummary}>{baseSummary}</span>}
        </div>
        <div
          ref={baseRef}
          style={{
            ...zoneRowStyles.cardArea,
            ...((onBaseDrop || onMoveDrop) && baseBattlefield ? zoneRowStyles.dropArea : {}),
            ...(pendingMoveDestinationId === baseBattlefield?.id ? zoneRowStyles.pendingDestination : {}),
          }}
          onDragOver={e => {
            if ((!onBaseDrop && !onMoveDrop) || !baseBattlefield) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={e => {
            if ((!onBaseDrop && !onMoveDrop) || !baseBattlefield) return;
            e.preventDefault();
            const unitInstanceId = e.dataTransfer.getData('application/riftbound-unit');
            if (unitInstanceId && onMoveDrop) {
              onMoveDrop(unitInstanceId, baseBattlefield.id);
              return;
            }
            const cardInstanceId =
              e.dataTransfer.getData('application/riftbound-card') ||
              e.dataTransfer.getData('text/plain');
            if (cardInstanceId) onBaseDrop?.(cardInstanceId, baseBattlefield.id);
          }}
        >
          {baseContentIds.length > 0 ? (
            baseContentIds.map(id => {
              const card = allCards[id];
              const def = card ? cardDefs[card.cardId] : undefined;
              const canDragMove = Boolean(
                !isOpponent &&
                canMoveUnits &&
                card &&
                def?.type === 'Unit' &&
                card.ownerId === playerId &&
                card.ready &&
                !card.exhausted
              );
              return (
                <ZoneCard
                  key={id}
                  cardId={id}
                  allCards={allCards}
                  cardDefs={cardDefs}
                  legionActiveCardIds={legionActiveCardIds}
                  isOpponent={isOpponent}
                  size="md"
                  maxHeightPx={isNarrow ? Math.min(baseCardH, 108) : baseCardH}
                  canDragMove={canDragMove}
                  isPendingMove={pendingMoveUnitIds?.has(id) ?? false}
                  onMoveDragStart={onMoveDragStart}
                />
              );
            })
          ) : (
            <div style={{ ...zoneRowStyles.empty, borderColor: '#7c3aed33' }}>
              <span style={{ color: '#7c3aed33', fontSize: '20px' }}>◇</span>
            </div>
          )}
        </div>
      </div>

      {/* Legend + Champion — grouped and flushed right */}
      <div style={sideZonesStyle}>
        {/* Legend */}
        <div style={zoneRowStyles.zone}>
          <div style={{ ...zoneRowStyles.zoneLabel, color: '#d4a84388' }}>LEGEND</div>
          <div ref={legendRef} style={zoneRowStyles.cardArea}>
              {legendIds.length > 0 ? (
              legendIds.map(id => (
                <ZoneCard key={id} cardId={id} allCards={allCards} cardDefs={cardDefs} legionActiveCardIds={legionActiveCardIds} isOpponent={isOpponent} size="md" maxHeightPx={legendCardH} />
              ))
            ) : (
              <div style={{ ...zoneRowStyles.empty, borderColor: '#d4a84333' }}>
                <span style={{ color: '#d4a84333', fontSize: '20px' }}>◆</span>
              </div>
            )}
          </div>
        </div>

        {/* Champion */}
        <div style={zoneRowStyles.zone}>
          <div style={{ ...zoneRowStyles.zoneLabel, color: '#3b82f688' }}>CHAMPION</div>
          <div ref={champRef} style={zoneRowStyles.cardArea}>
            {championIds.length > 0 ? (
              championIds.map(id => (
                <ZoneCard key={id} cardId={id} allCards={allCards} cardDefs={cardDefs} isOpponent={isOpponent} size="md" maxHeightPx={champCardH} />
              ))
            ) : (
              <div style={{ ...zoneRowStyles.empty, borderColor: '#3b82f633' }}>
                <span style={{ color: '#3b82f633', fontSize: '20px' }}>★</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const zoneRowStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
    gap: '12px',
    padding: '2px 12px',
    borderRadius: '6px',
    border: '1px solid',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  sideZones: {
    display: 'flex',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    gap: '12px',
    marginLeft: 'auto',
    minHeight: 0,
    flexShrink: 0,
  },
  zone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  zoneHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    minHeight: '14px',
    flexShrink: 0,
    overflow: 'hidden',
  },
  zoneLabel: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 700,
    flexShrink: 0,
  },
  unitSummary: {
    color: '#cbd5e1',
    fontSize: '10px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    opacity: 0.82,
  },
  cardArea: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    width: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  dropArea: {
    border: '1px dashed rgba(124,58,237,0.45)',
    borderRadius: '8px',
    background: 'rgba(124,58,237,0.08)',
  },
  pendingDestination: {
    boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.52)',
    background: 'rgba(251,191,36,0.10)',
  },
  empty: {
    width: '64px',
    height: '30px',
    border: '1px dashed',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    maxWidth: '100%',
  },
};

// ─────────────────────────────────────────
// DeckArea — shows main deck + hand + graveyard for a player
// ─────────────────────────────────────────
interface DeckAreaProps {
  player: PlayerState | undefined;
  playerId: string;
  isOpponent: boolean;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  legionActiveCardIds?: string[];
  handCards: CardInstance[];
  opponentHandCount: number;
  myTurn?: boolean;
  phase?: Phase;
  hasShowdownFocus?: boolean;
  onCardClick?: (instanceId: string) => void;
  pendingSpell?: PendingSpell | null;
  onSpellCardClick?: (instanceId: string) => void;
  pendingHideCardId?: string | null;
  onHideCardClick?: (instanceId: string) => void;
  compactCards?: boolean;
  onGraveyardClick?: () => void;
}

function DeckArea({ player, playerId, isOpponent, allCards, cardDefs, legionActiveCardIds, handCards, opponentHandCount, myTurn = false, phase, hasShowdownFocus = false, onCardClick, pendingSpell, onSpellCardClick, pendingHideCardId, onHideCardClick, compactCards = false, onGraveyardClick }: DeckAreaProps) {
  if (!player) return null;

  const accentColor = isOpponent ? '#ef4444' : '#22c55e';

  const rowRef = React.useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = React.useState(0);
  const [rowW, setRowW] = React.useState(0);

  React.useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setRowH(entry.contentRect.height);
        setRowW(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setRowW(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Reserve label/count space, then clamp each zone to the shared board scale.
  const narrowDeckRow = rowW > 0 && rowW < 520;
  const stackMax = narrowDeckRow ? CARD_HEIGHTS.narrowStackMax : isOpponent ? CARD_HEIGHTS.opponentStackMax : CARD_HEIGHTS.stackMax;
  const cardMaxH = fitCardHeight(rowH - 34, CARD_HEIGHTS.stackMin, stackMax);
  const handMaxH = fitCardHeight(
    rowH - (compactCards ? 56 : 36),
    narrowDeckRow ? CARD_HEIGHTS.narrowHandMin : CARD_HEIGHTS.handMin,
    narrowDeckRow ? CARD_HEIGHTS.narrowHandMax : compactCards ? CARD_HEIGHTS.handShortMax : CARD_HEIGHTS.handMax
  );

  // Top card of main deck — always hidden (never revealed to players)
  // The deck count is shown but the top card is never exposed
  const _deckTopId = player.deck[player.deck.length - 1]; // intentionally unused — deck is hidden

  // Top card of graveyard (last in array = top of discard)
  const gyTopId = player.discardPile[player.discardPile.length - 1];
  const gyTopCard = gyTopId ? allCards[gyTopId] : undefined;
  const gyTopDef = gyTopCard ? cardDefs[gyTopCard.cardId] : undefined;

  const handVisible = !isOpponent;

  return (
    <div ref={rowRef} style={deckAreaStyles.row}>
      {/* Graveyard (left) */}
      <CardStack
        count={player.discardPile.length}
        label="GRAVEYARD"
        topCard={gyTopCard}
        cardDef={gyTopDef ?? null}
        accentColor="#6b7280"
        isPlayer={!isOpponent}
        size="sm"
        maxHeightPx={cardMaxH}
        onClick={onGraveyardClick}
      />

      {/* Hand (center) */}
      {isOpponent ? (
        <OpponentHandRow count={opponentHandCount} />
      ) : (
        <PlayerHandRow
          cards={handCards}
          cardDefs={cardDefs}
          legionActiveCardIds={legionActiveCardIds}
          onCardClick={onCardClick}
          pendingSpell={pendingSpell}
          onSpellCardClick={onSpellCardClick}
          pendingHideCardId={pendingHideCardId}
          onHideCardClick={onHideCardClick}
          canInteract={(myTurn && phase === 'Action') || (phase === 'Showdown' && hasShowdownFocus)}
          maxCardHeight={handMaxH}
        />
      )}

      {/* Main Deck (right) — always hidden, count only */}
      <CardStack
        count={player.deck.length}
        label="MAIN DECK"
        topCard={undefined}
        cardDef={null}
        accentColor={accentColor}
        isPlayer={!isOpponent}
        size="sm"
        hidden={true}
        maxHeightPx={cardMaxH}
      />
    </div>
  );
}

const deckAreaStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
    gap: '12px',
    padding: '4px 12px',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
};

// ─────────────────────────────────────────
// UnitZoneModal — shows all units on a side when the unit area is clicked
// ─────────────────────────────────────────
interface UnitZoneModalProps {
  title: string;
  units: CardInstance[];
  cardDefs: Record<string, CardDefinition>;
  accentColor: string;
  onClose: () => void;
}

function UnitZoneModal({ title, units, cardDefs, accentColor, onClose }: UnitZoneModalProps) {
  return (
    <div style={unitZoneModalStyles.overlay} onClick={onClose}>
      <div style={unitZoneModalStyles.modal} onClick={e => e.stopPropagation()}>
        <div style={unitZoneModalStyles.header}>
          <div style={unitZoneModalStyles.headerLeft}>
            <span style={{ ...unitZoneModalStyles.dot, background: accentColor }} />
            <h2 style={unitZoneModalStyles.title}>{title}</h2>
            <span style={unitZoneModalStyles.count}>
              {units.length} unit{units.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button style={unitZoneModalStyles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>
        {units.length === 0 ? (
          <div style={unitZoneModalStyles.empty}>No units.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', padding: '0 2px' }}>
              <span style={{ color: '#e63946', fontWeight: 800, fontSize: '13px' }}>
                ⚔ {units.reduce((s, u) => s + (u.currentStats.might ?? u.stats.might ?? 0), 0)} might
              </span>
              <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: '13px' }}>
                ♥ {units.reduce((s, u) => s + (u.damage ?? 0), 0)} damage
              </span>
            </div>
            <div style={unitZoneModalStyles.grid}>
              {units.map(unit => {
                const def = cardDefs[unit.cardId];
                const might = unit.currentStats.might ?? unit.stats.might ?? 0;
                const damage = unit.damage ?? 0;
                return (
                  <div key={unit.instanceId} style={unitZoneModalStyles.cardWrapper}>
                    <CardArtView
                      card={unit}
                      cardDef={def}
                      isOpponent={false}
                      showStats={true}
                      showKeywords={true}
                      size="md"
                      forceReady={true}
                    />
                    <div style={unitZoneModalStyles.cardStats}>
                      <span style={{ color: '#e63946', fontWeight: 800 }}>⚔{might}</span>
                      <span style={{ color: '#e8e8e8', fontWeight: 800 }}>♥{damage}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const unitZoneModalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    backdropFilter: 'blur(4px)',
    padding: '16px',
  },
  modal: {
    background: 'linear-gradient(180deg, #1e1b35 0%, #111827 100%)',
    border: '1px solid rgba(148,163,184,0.28)',
    borderRadius: '14px',
    padding: '24px 28px',
    maxWidth: '860px',
    width: 'min(860px, calc(100vw - 24px))',
    maxHeight: 'calc(100dvh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.62)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  title: {
    color: '#f8fafc',
    fontSize: '20px',
    fontWeight: 900,
    margin: 0,
  },
  count: {
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 600,
    marginLeft: '4px',
  },
  closeBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    color: '#94a3b8',
    fontSize: '16px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 0',
    color: '#555',
    fontSize: '14px',
    fontStyle: 'italic',
  },
  grid: {
    display: 'flex',
    gap: '14px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    overflowY: 'auto',
    paddingBottom: '4px',
  },
  cardWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  cardStats: {
    display: 'flex',
    gap: '8px',
    fontSize: '13px',
  },
};

// ─────────────────────────────────────────
// BattlefieldRow — renders all battlefields in the center row
// ─────────────────────────────────────────
interface BattlefieldRowProps {
  gameState: import('../../shared/types').GameState;
  playerId: string;
  myTurn: boolean;
  canMoveUnits?: boolean;
  pendingMoveUnitIds?: Set<string>;
  pendingMoveDestinationId?: string | null;
  pendingSpell?: PendingSpell | null;
  pendingHideCardId?: string | null;
  highlightedUnitId?: string | null;
  isNarrow?: boolean;
  onBattlefieldUnitClick?: (unitInstanceId: string) => void;
  handleAction?: (type: string, payload?: Record<string, unknown>) => void;
  onBattlefieldDrop?: (cardInstanceId: string, battlefieldId: string) => void;
  onMoveDrop?: (cardInstanceId: string, destinationBattlefieldId: string) => void;
  onMoveDragStart?: (cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => void;
  onHideBattlefield?: (battlefieldId: string) => void;
  onPlayHiddenCard?: (cardInstanceId: string) => void;
}

function BattlefieldRow({
  gameState, playerId, myTurn,
  canMoveUnits = false, pendingMoveUnitIds, pendingMoveDestinationId, pendingSpell, pendingHideCardId, highlightedUnitId, isNarrow = false,
  onBattlefieldUnitClick, handleAction, onBattlefieldDrop, onMoveDrop, onMoveDragStart, onHideBattlefield, onPlayHiddenCard,
}: BattlefieldRowProps) {
  const { battlefields, allCards, cardDefinitions, legionActiveCardIds } = gameState;
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = React.useState(0);

  // Unit zone modal state
  const [unitZoneModal, setUnitZoneModal] = React.useState<{
    units: CardInstance[];
    title: string;
    accentColor: string;
  } | null>(null);

  React.useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setRowH(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setRowH(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const battlefieldCardH = fitCardHeight(rowH - 44, CARD_HEIGHTS.battlefieldMin, CARD_HEIGHTS.battlefieldMax);
  const centerBattlefields = battlefields.filter(bf => !isBaseBattlefieldId(bf.id));

  if (!centerBattlefields.length) {
    return <div style={bfRowStyles.empty}>No battlefields</div>;
  }

  // Each unit card gets portrait orientation stacked vertically with small offsets
  const UNIT_CARD_H = 86;  // sm CardArtView portrait height
  const OVERLAP_Y = 24;    // vertical offset between stacked cards
  const OVERLAP_X = 24;    // horizontal offset between stacked cards

  function renderUnitColumn(units: CardInstance[], isEnemy: boolean, accentColor: string, label: string) {
    if (units.length === 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden', padding: '8px' }}>
          <div style={bfRowStyles.rowLabel}>{label}</div>
          <div style={{ ...bfRowStyles.emptyState, fontSize: '11px' }}>—</div>
        </div>
      );
    }

    const totalMight = units.reduce((sum, u) => sum + (u.currentStats.might ?? u.stats.might ?? 0), 0);
    const summary = summarizeUnits(units);

    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'visible', padding: '8px', cursor: 'pointer' }}
        onClick={() => setUnitZoneModal({ units, title: label, accentColor })}
        title={`${label} units — click to view all`}
      >
        <div style={bfRowStyles.rowLabel}>{label}</div>
        <div style={bfRowStyles.unitSummaryPill}>
          <span style={{ color: '#e63946', fontWeight: 900 }}>Might {totalMight}</span>
          <span>{summary.count} unit{summary.count === 1 ? '' : 's'}</span>
          {summary.damage > 0 && <span>{summary.damage} dmg</span>}
          {summary.exhausted > 0 && <span>{summary.exhausted} exhausted</span>}
        </div>
        {/* Vertically stacked portrait cards with overlap */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          position: 'relative',
          height: `${UNIT_CARD_H - (units.length - 1) * OVERLAP_Y}px`,
          minWidth: '86px',
          overflow: 'visible',
        }}>
          {units.map((unit, idx) => {
            const def = cardDefinitions[unit.cardId];
            const isReady = unit.ready && !unit.exhausted;
            const isExhausted = unit.exhausted;
            const isSpellTarget = pendingSpell?.targetType === 'unit' && pendingSpell.selectedTargetIds.includes(unit.instanceId);
            const isTargetable = pendingSpell?.targetType === 'unit';
            const isPendingMove = pendingMoveUnitIds?.has(unit.instanceId) ?? false;
            const canDragMove = canMoveUnits && isReady;

            // CardArtView handles exhaustion rotation internally (isExhaustedUnitOrGear).
            // Wrapper only handles stacking offset and visual state.
            const offsetY = idx * OVERLAP_Y;
            const highlightBorder = isSpellTarget ? '#fbbf24' : isEnemy ? '#ef4444' : '#22c55e';

            return (
              <div
                key={unit.instanceId}
                draggable={canDragMove}
                onDragStart={e => {
                  if (!canDragMove) return;
                  e.stopPropagation();
                  onMoveDragStart?.(unit.instanceId, e);
                }}
                onClick={e => {
                  e.stopPropagation();
                  if (isTargetable) onBattlefieldUnitClick?.(unit.instanceId);
                }}
                style={{
                  position: 'absolute',
                  left: idx * OVERLAP_X,
                  top: offsetY,
                  borderRadius: '6px',
                  boxShadow: isSpellTarget
                    ? `0 0 10px rgba(251,191,36,0.6)`
                    : `0 1px 3px rgba(0,0,0,0.3)`,
                  opacity: isPendingMove ? 0.72 : 1,
                  cursor: isTargetable ? 'crosshair' : canDragMove ? 'grab' : 'pointer',
                  outline: unit.instanceId === highlightedUnitId
                    ? '3px solid rgba(251,191,36,0.95)'
                    : isSpellTarget ? '2px solid rgba(251,191,36,0.9)' : isPendingMove ? '2px solid rgba(251,191,36,0.9)' : 'none',
                  outlineOffset: '2px',
                  transition: 'opacity 0.15s ease',
                  zIndex: idx,
                }}
                title={def?.name ?? unit.cardId}
              >
                <CardArtView
                  card={unit}
                  cardDef={def}
                  isOpponent={false}
                  showStats={false}
                  showKeywords={false}
                  size="sm"
                  landscape={false}
                  border={`2px solid ${highlightBorder}`}
                  onHover={undefined}
                />
                {/* Ready dot */}
                <div style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '2px',
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: isReady ? '#22c55e' : '#555',
                }} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={rowRef} style={bfRowStyles.container}>
        {centerBattlefields.map(bf => {
          const myUnits = bf.units.map(id => allCards[id]).filter(c => c && c.ownerId === playerId);
          const enemyUnits = bf.units.map(id => allCards[id]).filter(c => c && c.ownerId !== playerId);
          const bfColor = BF_COLORS[bf.cardId] ?? '#374151';
          const controlledByMe = myUnits.length > 0 && enemyUnits.length === 0;
          const controlledByEnemy = enemyUnits.length > 0 && myUnits.length === 0;
          const contested = myUnits.length > 0 && enemyUnits.length > 0;
          const myHiddenHere = Object.values(allCards).filter(card =>
            card.ownerId === playerId && card.location === 'hidden' && card.hiddenBattlefieldId === bf.id
          );
          const enemyHiddenHere = Object.values(allCards).filter(card =>
            card.ownerId !== playerId && card.location === 'hidden' && card.hiddenBattlefieldId === bf.id
          );
          const canHideHere = Boolean(pendingHideCardId)
            && bf.controllerId === playerId
            && myHiddenHere.length === 0;
          const territoryStyle = contested
            ? bfRowStyles.contestedPanel
            : controlledByMe
              ? bfRowStyles.myTerritoryPanel
              : controlledByEnemy
                ? bfRowStyles.enemyTerritoryPanel
                : {};

          return (
            <div
              key={bf.id}
              style={{
                ...bfRowStyles.bfPanel,
                ...((onBattlefieldDrop || onMoveDrop) ? bfRowStyles.dropPanel : {}),
                ...(pendingMoveDestinationId === bf.id ? bfRowStyles.pendingDropPanel : {}),
                borderColor: bfColor + '55',
                ...territoryStyle,
                ...(pendingHideCardId ? bfRowStyles.hideTargetPanel : {}),
                ...(canHideHere ? bfRowStyles.hideLegalPanel : {}),
                flexDirection: 'row',
                cursor: canHideHere ? 'pointer' : undefined,
              }}
              onClick={() => {
                if (canHideHere) onHideBattlefield?.(bf.id);
              }}
              onDragOver={e => {
                if (!onBattlefieldDrop && !onMoveDrop) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={e => {
                if (!onBattlefieldDrop && !onMoveDrop) return;
                e.preventDefault();
                const unitInstanceId = e.dataTransfer.getData('application/riftbound-unit');
                if (unitInstanceId && onMoveDrop) {
                  onMoveDrop(unitInstanceId, bf.id);
                  return;
                }
                const cardInstanceId =
                  e.dataTransfer.getData('application/riftbound-card') ||
                  e.dataTransfer.getData('text/plain');
                if (cardInstanceId) onBattlefieldDrop?.(cardInstanceId, bf.id);
              }}
            >
              {/* Left: player units */}
              {renderUnitColumn(myUnits, false, '#22c55e', 'Your')}

              {/* Center: battlefield card art */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minWidth: isNarrow ? '112px' : '132px', padding: '4px 8px', gap: '2px' }}>
                <CardArtView
                  card={{ instanceId: bf.id, cardId: bf.cardId, ownerId: '', location: 'battlefield', currentStats: { might: 0, health: 0 }, stats: { might: 0, health: 0 }, ready: false, exhausted: false, counters: {}, attachments: [], facing: 'up', owner_hidden: false }}
                  cardDef={CARDS[bf.cardId] ?? cardDefinitions[bf.cardId]}
                  isOpponent={false}
                  showStats={false}
                  showKeywords={false}
                  size="lg"
                  maxHeight={battlefieldCardH}
                  landscape={true}
                />
                <span style={{ fontSize: '10px', fontWeight: 700, color: bfColor }}>{bf.name}</span>
                {(myHiddenHere.length > 0 || enemyHiddenHere.length > 0) && (
                  <div style={bfRowStyles.hiddenRow}>
                    {myHiddenHere.map(hiddenCard => {
                      const hiddenDef = cardDefinitions[hiddenCard.cardId];
                      return (
                        <button
                          key={hiddenCard.instanceId}
                          type="button"
                          style={bfRowStyles.hiddenButton}
                          onClick={e => {
                            e.stopPropagation();
                            onPlayHiddenCard?.(hiddenCard.instanceId);
                          }}
                          title={`Play ${hiddenDef?.name ?? 'hidden card'}`}
                        >
                          <span style={bfRowStyles.hiddenIcon}>?</span>
                          <span style={bfRowStyles.hiddenName}>{hiddenDef?.name ?? 'Hidden'}</span>
                          <span style={bfRowStyles.hiddenPlayText}>Play</span>
                        </button>
                      );
                    })}
                    {enemyHiddenHere.length > 0 && (
                      <span style={bfRowStyles.enemyHiddenPill}>
                        <span style={bfRowStyles.hiddenIcon}>?</span>
                        Enemy hidden x{enemyHiddenHere.length}
                      </span>
                    )}
                  </div>
                )}
                {canHideHere && <span style={bfRowStyles.hidePrompt}>Click to hide here</span>}
              </div>

              {/* Right: opponent units */}
              {renderUnitColumn(enemyUnits, true, '#ef4444', 'Enemy')}
            </div>
          );
        })}
      </div>

      {/* Unit zone modal */}
      {unitZoneModal && (
        <UnitZoneModal
          title={unitZoneModal.title}
          units={unitZoneModal.units}
          cardDefs={cardDefinitions}
          accentColor={unitZoneModal.accentColor}
          onClose={() => setUnitZoneModal(null)}
        />
      )}
    </>
  );
}

const BF_COLORS: Record<string, string> = {
  Baron_Pit: '#7c3aed',
  Brush: '#16a34a',
  The_Grid: '#64748b',
};

const bfRowStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: '10px',
    width: '100%',
    alignItems: 'stretch',
    overflowX: 'auto',
    padding: '4px 0',
    minHeight: 0,
    flex: 1,
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: '13px',
    fontStyle: 'italic',
    minHeight: 0,
  },
  bfPanel: {
    flex: 1,
    minWidth: '270px',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    minHeight: 0,
  },
  myTerritoryPanel: {
    borderColor: 'rgba(34,197,94,0.72)',
    boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.22), 0 0 18px rgba(34,197,94,0.12)',
  },
  enemyTerritoryPanel: {
    borderColor: 'rgba(239,68,68,0.72)',
    boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.22), 0 0 18px rgba(239,68,68,0.12)',
  },
  contestedPanel: {
    borderColor: 'rgba(212,168,67,0.74)',
    boxShadow: 'inset 0 0 0 1px rgba(212,168,67,0.24), 0 0 18px rgba(212,168,67,0.12)',
  },
  dropPanel: {
    outline: '1px dashed rgba(255,255,255,0.16)',
    outlineOffset: '-4px',
  },
  pendingDropPanel: {
    boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.48), 0 2px 8px rgba(0,0,0,0.2)',
    background: 'rgba(251,191,36,0.08)',
  },
  hideTargetPanel: {
    filter: 'saturate(0.82)',
  },
  hideLegalPanel: {
    borderColor: 'rgba(251,191,36,0.92)',
    boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.52), 0 0 20px rgba(251,191,36,0.16)',
    background: 'rgba(251,191,36,0.08)',
    filter: 'none',
  },
  hiddenRow: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '154px',
  },
  hiddenButton: {
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '5px',
    border: '1px solid rgba(251,191,36,0.75)',
    borderRadius: '8px',
    padding: '4px 6px',
    background: 'linear-gradient(135deg, rgba(120,53,15,0.96), rgba(15,23,42,0.94))',
    color: '#fde68a',
    fontSize: '10px',
    fontWeight: 900,
    width: '148px',
    cursor: 'pointer',
    boxShadow: '0 0 14px rgba(251,191,36,0.24)',
  },
  hiddenIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '22px',
    borderRadius: '4px',
    background: 'linear-gradient(135deg, #111827, #451a03)',
    border: '1px solid rgba(251,191,36,0.55)',
    color: '#fbbf24',
    fontSize: '12px',
    fontWeight: 900,
  },
  hiddenName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'left',
  },
  hiddenPlayText: {
    color: '#fef3c7',
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  enemyHiddenPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    border: '1px solid rgba(148,163,184,0.45)',
    borderRadius: '8px',
    padding: '4px 6px',
    background: 'linear-gradient(135deg, rgba(30,41,59,0.96), rgba(15,23,42,0.94))',
    color: '#cbd5e1',
    fontSize: '10px',
    fontWeight: 900,
    whiteSpace: 'nowrap',
    boxShadow: '0 0 12px rgba(148,163,184,0.16)',
  },
  hidePrompt: {
    color: '#fbbf24',
    fontSize: '10px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  bfHeader: {
    height: '44px',
    flexShrink: 0,
    padding: '7px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  bfArtWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  bfName: {
    fontWeight: 800,
    fontSize: '13px',
  },
  bfMeta: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  controller: {
    fontSize: '11px',
    fontWeight: 700,
  },
  unitArea: {
    flex: 1,
    padding: '8px',
    minHeight: 0,
    flexDirection: 'column',
    gap: '6px',
  },
  unitRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  rowLabel: {
    fontSize: '9px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  mightTotal: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginBottom: '4px',
  },
  unitSummaryPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    maxWidth: '100%',
    marginBottom: '4px',
    padding: '2px 6px',
    borderRadius: '999px',
    background: 'rgba(15,23,42,0.72)',
    border: '1px solid rgba(148,163,184,0.12)',
    color: '#cbd5e1',
    fontSize: '9px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  unitRowInner: {
    display: 'flex',
    gap: '5px',
    flexWrap: 'wrap',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: '12px',
    fontStyle: 'italic',
    minHeight: 0,
  },
  unitChip: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '4px 6px',
    background: 'rgba(20,20,35,0.8)',
    border: '1px solid',
    borderRadius: '6px',
    minWidth: '56px',
    transition: 'all 0.15s ease',
  },
  unitName: {
    fontSize: '9px',
    fontWeight: 700,
    color: '#e8e8e8',
    maxWidth: '62px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  keywords: {
    display: 'flex',
    gap: '2px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '2px',
  },
  keyword: {
    fontSize: '7px',
    padding: '1px 3px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '2px',
    color: '#888',
  },
  unitStats: {
    display: 'flex',
    gap: '8px',
    marginTop: '3px',
  },
  statNum: {
    fontSize: '12px',
    fontWeight: 800,
  },
  readyDot: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    marginTop: '3px',
  },
  actionHint: {
    padding: '2px 7px',
    borderRadius: '999px',
    background: 'rgba(249,115,22,0.18)',
    border: '1px solid rgba(249,115,22,0.36)',
    color: '#fdba74',
    fontSize: '9px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  targetHint: {
    marginTop: '2px',
    color: '#fbbf24',
    fontSize: '8px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  attackBtn: {
    margin: '6px 8px',
    padding: '6px 12px',
    background: 'linear-gradient(135deg, #e63946, #c62828)',
    border: 'none',
    borderRadius: '5px',
    color: 'white',
    fontWeight: 700,
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(230,57,70,0.3)',
  },
};

// ─────────────────────────────────────────
// TopBar — player info | turn tracker | opponent info
// ─────────────────────────────────────────
interface TopBarProps {
  player: PlayerState | undefined;
  opponent: PlayerState | undefined;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  turn: number;
  phase: Phase;
  myTurn: boolean;
  compact?: boolean;
}

function TopBar({ player, opponent, allCards, cardDefs, turn, phase, myTurn, compact = false }: TopBarProps) {
  const prompt = getTurnPrompt(phase, myTurn);

  return (
    <div style={{ ...topBarStyles.bar, ...(compact ? topBarStyles.barCompact : {}) }}>
      {/* Left: player info */}
      <PlayerInfoBar
        player={player}
        isPlayer={true}
        allCards={allCards}
        cardDefs={cardDefs}
        compact={compact}
      />

      {/* Center: turn tracker */}
      <div style={{ ...topBarStyles.center, ...(compact ? topBarStyles.centerCompact : {}) }}>
        <div style={{ ...topBarStyles.commandStrip, ...(compact ? topBarStyles.commandStripCompact : {}) }}>
          <span style={{ ...topBarStyles.commandPhase, color: myTurn ? '#fdba74' : '#cbd5e1' }}>
            {myTurn ? 'You' : 'AI'} - {getPhaseLabel(phase)}
          </span>
          {!compact && <span style={topBarStyles.commandPrompt}>{prompt}</span>}
        </div>
        <PhaseIndicator phase={phase} turn={turn} myTurn={myTurn} />
        <div style={{ display: 'none' }}>
          <span style={topBarStyles.turnLabel}>Turn {turn}</span>
          <span style={{
            ...topBarStyles.turnBadge,
            color: myTurn ? '#e63946' : '#888',
            background: myTurn ? 'rgba(230,57,70,0.15)' : 'rgba(255,255,255,0.05)',
          }}>
            {myTurn ? '▶ YOUR TURN' : '○ OPPONENT'}
          </span>
        </div>
      </div>

      {/* Right: opponent info */}
      <PlayerInfoBar
        player={opponent}
        isPlayer={false}
        allCards={allCards}
        cardDefs={cardDefs}
        reversed={true}
        compact={compact}
      />
    </div>
  );
}

const topBarStyles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    background: 'rgba(0,0,0,0.7)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
    gap: '16px',
  },
  barCompact: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: 'auto auto',
    gap: '6px',
    padding: '6px 8px',
    alignItems: 'stretch',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  centerCompact: {
    gridColumn: '1 / -1',
    gridRow: 2,
    order: 3,
    gap: '4px',
    overflowX: 'auto',
  },
  commandStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    maxWidth: '520px',
    padding: '6px 12px',
    background: 'rgba(15,23,42,0.88)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: '10px',
    boxShadow: '0 8px 22px rgba(0,0,0,0.24)',
  },
  commandPhase: {
    fontSize: '11px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    whiteSpace: 'nowrap',
  },
  commandPrompt: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  turnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  turnLabel: {
    fontSize: '11px',
    color: '#aaa',
  },
  turnBadge: {
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 10px',
    borderRadius: '10px',
  },
};

// ─────────────────────────────────────────
// Main BoardLayout
// ─────────────────────────────────────────
function PlayConfirmModal({
  pending,
  accelerateEnabled,
  onToggleAccelerate,
  onConfirm,
  onCancel,
}: {
  pending: PendingPlayAction;
  accelerateEnabled: boolean;
  onToggleAccelerate: (enabled: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const hasAccelerate = pending.hasAccelerate;
  const runeCost = pending.runeCost ?? 0;
  const powerCost = pending.powerCost ?? 0;
  // Accelerate adds +1 rune (energy) and +1 power to the base cost
  const accelerateRuneCost = runeCost + 1;
  const acceleratePowerCost = powerCost + 1;
  const canAffordAccelerate = (pending.availableRunes ?? 0) >= accelerateRuneCost;

  return (
    <div style={confirmStyles.backdrop} onClick={onCancel}>
      <div style={confirmStyles.dialog} onClick={e => e.stopPropagation()}>
        <div style={confirmStyles.title}>Confirm Play</div>
        <div style={confirmStyles.cardName}>{pending.cardName}</div>
        <div style={confirmStyles.summary}>
          <span>{pending.cardType}</span>
          <span>{pending.destinationLabel}</span>
        </div>
        <div style={confirmStyles.costRow}>
          <span>Rune cost</span>
          <strong>{accelerateEnabled ? accelerateRuneCost : runeCost}</strong>
        </div>
        {powerCost > 0 && (
          <div style={confirmStyles.costRow}>
            <span>Power cost</span>
            <strong>{accelerateEnabled ? acceleratePowerCost : powerCost}</strong>
          </div>
        )}
        <div style={confirmStyles.costRow}>
          <span>Available runes</span>
          <strong>{pending.availableRunes}</strong>
        </div>
        {hasAccelerate && (
          <div style={confirmStyles.accelerateRow}>
            <button
              type="button"
              style={{
                ...confirmStyles.accelerateButton,
                ...(accelerateEnabled ? confirmStyles.accelerateButtonActive : {}),
                ...(!canAffordAccelerate ? confirmStyles.accelerateButtonDisabled : {}),
              }}
              onClick={() => canAffordAccelerate && onToggleAccelerate(!accelerateEnabled)}
              disabled={!canAffordAccelerate}
            >
              Accelerate
            </button>
          </div>
        )}
        <div style={confirmStyles.actions}>
          <button style={confirmStyles.cancelButton} onClick={onCancel}>Cancel</button>
          <button style={confirmStyles.confirmButton} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

function MoveConfirmModal({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingMoveAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={confirmStyles.moveDock}>
      <div style={confirmStyles.dialog}>
        <div style={confirmStyles.title}>Confirm Move</div>
        <div style={confirmStyles.cardName}>{pending.destinationLabel}</div>
        <div style={confirmStyles.summary}>
          <span>{pending.units.length} unit{pending.units.length === 1 ? '' : 's'}</span>
          <span>Move action</span>
        </div>
        <div style={confirmStyles.moveList}>
          {pending.units.map(unit => (
            <div key={unit.unitId} style={confirmStyles.moveItem}>
              <strong>{unit.unitName}</strong>
              <span>{unit.originLabel}{' -> '}{pending.destinationLabel}</span>
            </div>
          ))}
        </div>
        <div style={confirmStyles.actions}>
          <button style={confirmStyles.cancelButton} onClick={onCancel}>Cancel</button>
          <button style={confirmStyles.confirmButton} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

const confirmStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.62)',
    padding: '16px',
  },
  dialog: {
    width: 'min(360px, calc(100vw - 24px))',
    maxHeight: 'calc(100dvh - 32px)',
    padding: '18px',
    borderRadius: '8px',
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    overflowY: 'auto',
  },
  moveDock: {
    position: 'fixed',
    left: '50%',
    bottom: '18px',
    transform: 'translateX(-50%)',
    zIndex: 10000,
    width: 'min(380px, calc(100vw - 32px))',
    pointerEvents: 'auto',
  },
  title: {
    fontSize: '12px',
    fontWeight: 900,
    color: '#fdba74',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
  },
  cardName: {
    fontSize: '18px',
    fontWeight: 900,
    color: '#f8fafc',
  },
  summary: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    color: '#cbd5e1',
    fontSize: '13px',
  },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    color: '#e2e8f0',
    fontSize: '13px',
  },
  accelerateRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: '4px',
  },
  accelerateButton: {
    padding: '6px 16px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontSize: '12px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  accelerateButtonActive: {
    background: '#16a34a',
    borderColor: '#22c55e',
    color: '#ffffff',
  },
  accelerateButtonDisabled: {
    opacity: 0.38,
    cursor: 'not-allowed',
  },
  moveList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '220px',
    overflowY: 'auto',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    paddingTop: '10px',
  },
  moveItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    color: '#cbd5e1',
    fontSize: '12px',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '4px',
  },
  cancelButton: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontWeight: 800,
    cursor: 'pointer',
  },
  confirmButton: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: 'none',
    background: '#22c55e',
    color: '#052e16',
    fontWeight: 900,
    cursor: 'pointer',
  },
};

// ─────────────────────────────────────────
// Spell targeting helpers
// ─────────────────────────────────────────
function getSpellTargeting(def: CardDefinition): SpellTargeting {
  const effectText = def.abilities.map(a => `${a.effect} ${a.effectCode ?? ''}`).join(' ').toLowerCase();

  const hitsGear = effectText.includes('equip') ||
    effectText.includes('target a gear');

  const hitsUnit = effectText.includes('unit') ||
    effectText.includes('deal') ||
    effectText.includes('buff') ||
    effectText.includes('stun') ||
    effectText.includes('banish') ||
    effectText.includes('ready') ||
    effectText.includes('kill') ||
    effectText.includes('destroy');

  // Spell with no target needed (e.g. card draw, board-wide effect)
  if (!hitsUnit && !hitsGear) return { needsTarget: false, targetType: 'unit' };

  if (hitsGear && !hitsUnit) return { needsTarget: true, targetType: 'gear' };
  return { needsTarget: true, targetType: 'unit' };
}

interface ShowdownState {
  focusPlayerId: string | null;
  chainOpen: boolean;
}

function canCastSpell(
  def: CardDefinition,
  myTurn: boolean,
  phase: Phase,
  showdown: ShowdownState | null,
  hasFocus: boolean,
): { allowed: boolean; reason?: string } {
  const hasReactionKeyword = def.keywords.includes('Reaction');
  const hasActionKeyword = def.keywords.includes('Action');
  const chainOpen = showdown?.chainOpen ?? false;

  // Non-showdown (Action phase): all spells can be cast on your turn
  if (phase !== 'Showdown') {
    if (phase === 'Action' && myTurn) return { allowed: true };
    return { allowed: false, reason: 'You can only cast spells during your turn in the Action phase.' };
  }

  // Showdown phase: action or reaction keyword required + focus
  if (!hasFocus) return { allowed: false, reason: 'You do not have focus.' };

  if (hasReactionKeyword) {
    // Reaction: must have open chain + focus
    if (!chainOpen) return { allowed: false, reason: 'No chain is open — reaction-speed spells require an open chain.' };
  } else if (hasActionKeyword) {
    // Action: must have no open chain + focus
    if (chainOpen) return { allowed: false, reason: 'A chain is open — only reaction-speed spells can be played.' };
  } else {
    // No keyword: cannot be played during showdown at all
    return { allowed: false, reason: 'This spell cannot be played during showdown.' };
  }

  return { allowed: true };
}

interface BoardLayoutProps {
  onExitToLobby?: () => void;
}

function summarizeUnits(units: CardInstance[]) {
  return {
    count: units.length,
    might: units.reduce((sum, unit) => sum + (unit.currentStats.might ?? unit.stats.might ?? 0), 0),
    damage: units.reduce((sum, unit) => sum + (unit.damage ?? 0), 0),
    exhausted: units.filter(unit => unit.exhausted || !unit.ready).length,
  };
}

function unitSummaryText(units: CardInstance[]): string {
  const summary = summarizeUnits(units);
  if (summary.count === 0) return 'No units';
  const parts = [`${summary.count} unit${summary.count === 1 ? '' : 's'}`, `${summary.might} might`];
  if (summary.damage > 0) parts.push(`${summary.damage} damage`);
  if (summary.exhausted > 0) parts.push(`${summary.exhausted} exhausted`);
  return parts.join(' | ');
}

interface GameOverModalProps {
  winnerName: string;
  isWinner: boolean;
  onExitToLobby?: () => void;
}

function GameOverModal({ winnerName, isWinner, onExitToLobby }: GameOverModalProps) {
  return (
    <div style={gameOverStyles.overlay}>
      <div style={gameOverStyles.modal}>
        <div style={{ ...gameOverStyles.result, color: isWinner ? '#22c55e' : '#ef4444' }}>
          {isWinner ? 'Victory' : 'Defeat'}
        </div>
        <div style={gameOverStyles.title}>Game Over</div>
        <div style={gameOverStyles.message}>{winnerName} wins.</div>
        <button
          style={gameOverStyles.button}
          onClick={onExitToLobby}
        >
          Return to Lobby
        </button>
      </div>
    </div>
  );
}

interface WarningToastsProps {
  warnings: PlayerWarning[];
  onDismiss: (id: string) => void;
}

function WarningToasts({ warnings, onDismiss }: WarningToastsProps) {
  React.useEffect(() => {
    if (warnings.length === 0) return;
    const timers = warnings.map(warning =>
      window.setTimeout(() => onDismiss(warning.id), 4200)
    );
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [warnings, onDismiss]);

  if (warnings.length === 0) return null;

  return (
    <div style={warningStyles.container} role="status" aria-live="polite">
      {warnings.slice(-3).map(warning => (
        <div key={warning.id} style={warningStyles.toast}>
          <div style={warningStyles.icon}>!</div>
          <div style={warningStyles.message}>{warning.message}</div>
          <button
            type="button"
            style={warningStyles.close}
            onClick={() => onDismiss(warning.id)}
            aria-label="Dismiss warning"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

function getDamagePriority(def?: CardDefinition): number {
  if (!def) return 1;
  const abilityText = (def.abilities ?? []).map(ability => ability.effect).join(' ');
  if (def.keywords.includes('Tank') || abilityText.includes('[Tank]')) return 0;
  if (def.keywords.includes('Backline') || abilityText.includes('[Backline]')) return 2;
  return 1;
}

function MobileBottomPanel({
  activeTab,
  onTabChange,
  handCards,
  cardDefs,
  gameLog,
  playerId,
  opponentName,
  pendingSpell,
  onCardClick,
  onSpellCardClick,
  pendingHideCardId,
  onHideCardClick,
}: {
  activeTab: 'hand' | 'log' | 'chat';
  onTabChange: (tab: 'hand' | 'log' | 'chat') => void;
  handCards: CardInstance[];
  cardDefs: Record<string, CardDefinition>;
  gameLog: string[];
  playerId: string;
  opponentName: string;
  pendingSpell: PendingSpell | null;
  onCardClick: (instanceId: string) => void;
  onSpellCardClick: (instanceId: string) => void;
  pendingHideCardId?: string | null;
  onHideCardClick?: (instanceId: string) => void;
}) {
  const tabs: Array<{ id: 'hand' | 'log' | 'chat'; label: string }> = [
    { id: 'hand', label: 'Hand' },
    { id: 'log', label: 'Log' },
    { id: 'chat', label: 'Chat' },
  ];

  return (
    <div style={mobilePanelStyles.panel}>
      <div style={mobilePanelStyles.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            style={{
              ...mobilePanelStyles.tab,
              ...(activeTab === tab.id ? mobilePanelStyles.tabActive : {}),
            }}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={mobilePanelStyles.body}>
        {activeTab === 'hand' && (
          <PlayerHandRow
            cards={handCards}
            cardDefs={cardDefs}
            onCardClick={onCardClick}
            pendingSpell={pendingSpell}
            onSpellCardClick={onSpellCardClick}
            pendingHideCardId={pendingHideCardId}
            onHideCardClick={onHideCardClick}
            canInteract={true}
            maxCardHeight={104}
            legionActiveCardIds={undefined}
          />
        )}
        {activeTab === 'log' && <GameLog messages={gameLog} />}
        {activeTab === 'chat' && <ChatBox playerId={playerId} opponentName={opponentName} compact />}
      </div>
    </div>
  );
}

const mobilePanelStyles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '178px',
    flexShrink: 0,
    padding: '0 8px 6px',
    gap: '6px',
    background: 'rgba(2,6,23,0.96)',
    borderTop: '1px solid rgba(148,163,184,0.16)',
  },
  tabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
    paddingTop: '7px',
    flexShrink: 0,
  },
  tab: {
    height: '28px',
    borderRadius: '7px',
    border: '1px solid rgba(148,163,184,0.18)',
    background: 'rgba(15,23,42,0.82)',
    color: '#94a3b8',
    fontSize: '11px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tabActive: {
    borderColor: 'rgba(249,115,22,0.7)',
    color: '#fdba74',
    background: 'rgba(249,115,22,0.16)',
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
};

function CombatDamageAssignmentPanel({
  gameState,
  playerId,
  isNarrow,
  onHoverTarget,
  onSubmit,
}: {
  gameState: GameState;
  playerId: string;
  isNarrow: boolean;
  onHoverTarget: (unitId: string | null) => void;
  onSubmit: (targetOrder: string[]) => void;
}) {
  const pending = gameState.pendingCombatDamageAssignment;
  const [targetOrder, setTargetOrder] = React.useState<string[]>([]);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  React.useEffect(() => setTargetOrder([]), [pending?.assigningPlayerId, pending?.sourceSide, pending?.availableDamage]);
  if (!pending || pending.assigningPlayerId !== playerId || gameState.showdown?.combatStep !== 'AssignDamage') return null;

  const targets = [...pending.legalTargetIds].sort((a, b) => {
    const aDef = gameState.cardDefinitions[gameState.allCards[a]?.cardId];
    const bDef = gameState.cardDefinitions[gameState.allCards[b]?.cardId];
    const priorityDiff = getDamagePriority(aDef) - getDamagePriority(bDef);
    return priorityDiff || pending.legalTargetIds.indexOf(a) - pending.legalTargetIds.indexOf(b);
  });
  const orderedTargets = [...targetOrder, ...targets.filter(id => !targetOrder.includes(id))];

  const canSubmit = targets.length > 0 || pending.availableDamage === 0;
  const sideLabel = pending.sourceSide === 'attacker' ? 'Attackers' : 'Defenders';
  const estimateDamage = (unitId: string, index: number): number => {
    const unit = gameState.allCards[unitId];
    const might = unit?.currentStats?.might ?? unit?.stats?.might ?? 0;
    const alreadyDamaged = unit?.damage ?? 0;
    const remaining = Math.max(0, might - alreadyDamaged);
    const previous = orderedTargets.slice(0, index).reduce((sum, id) => {
      const prev = gameState.allCards[id];
      const prevMight = prev?.currentStats?.might ?? prev?.stats?.might ?? 0;
      return sum + Math.max(0, prevMight - (prev?.damage ?? 0));
    }, 0);
    return Math.max(0, Math.min(remaining, pending.availableDamage - previous));
  };
  const move = (unitId: string, direction: -1 | 1) => {
    setTargetOrder(prev => {
      const current = [...prev, ...targets.filter(id => !prev.includes(id))];
      const index = current.indexOf(unitId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
      return current;
    });
  };
  const reorderTo = (unitId: string, destinationId: string) => {
    if (unitId === destinationId) return;
    setTargetOrder(prev => {
      const current = [...prev, ...targets.filter(id => !prev.includes(id))];
      const from = current.indexOf(unitId);
      const to = current.indexOf(destinationId);
      if (from < 0 || to < 0) return current;
      const [moved] = current.splice(from, 1);
      current.splice(to, 0, moved);
      return current;
    });
  };
  const preview = orderedTargets
    .map((unitId, index) => {
      const def = gameState.cardDefinitions[gameState.allCards[unitId]?.cardId];
      const damage = estimateDamage(unitId, index);
      return damage > 0 ? `${def?.name ?? unitId} takes ${damage}` : null;
    })
    .filter(Boolean)
    .join(', ');

  return (
    <div style={{ ...combatAssignStyles.panel, ...(isNarrow ? combatAssignStyles.panelNarrow : {}) }}>
      <div style={combatAssignStyles.header}>{sideLabel} choose damage order</div>
      <div style={combatAssignStyles.subhead}>Assign {pending.availableDamage} damage. Targets are damaged from top to bottom.</div>
      {preview && <div style={combatAssignStyles.preview}>{preview}</div>}
      <div style={combatAssignStyles.targets}>
        {orderedTargets.map((unitId, index) => {
          const unit = gameState.allCards[unitId];
          const def = unit ? gameState.cardDefinitions[unit.cardId] : undefined;
          const might = unit?.currentStats?.might ?? unit?.stats?.might ?? 0;
          const damage = unit?.damage ?? 0;
          const projected = estimateDamage(unitId, index);
          return (
            <div
              key={unitId}
              style={{
                ...combatAssignStyles.targetRow,
                ...(draggingId === unitId ? combatAssignStyles.draggingRow : {}),
              }}
              draggable
              onDragStart={() => setDraggingId(unitId)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                if (draggingId) reorderTo(draggingId, unitId);
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              onMouseEnter={() => onHoverTarget(unitId)}
              onMouseLeave={() => onHoverTarget(null)}
              onFocus={() => onHoverTarget(unitId)}
              onBlur={() => onHoverTarget(null)}
              tabIndex={0}
            >
              <span style={combatAssignStyles.orderBadge}>{index + 1}</span>
              <span style={combatAssignStyles.targetName}>{def?.name ?? unitId}</span>
              <span style={combatAssignStyles.targetMeta}>Might {might} | Damage {damage} | Takes {projected}</span>
              <button type="button" style={{ ...combatAssignStyles.iconButton, opacity: index === 0 ? 0.35 : 1 }} onClick={() => move(unitId, -1)} disabled={index === 0}>↑</button>
              <button type="button" style={{ ...combatAssignStyles.iconButton, opacity: index === orderedTargets.length - 1 ? 0.35 : 1 }} onClick={() => move(unitId, 1)} disabled={index === orderedTargets.length - 1}>↓</button>
            </div>
          );
        })}
      </div>
      <button
        style={{ ...combatAssignStyles.button, opacity: canSubmit ? 1 : 0.55 }}
        disabled={!canSubmit}
        onClick={() => onSubmit(orderedTargets)}
      >
        Confirm Order
      </button>
    </div>
  );
}

const combatAssignStyles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    right: '304px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 120,
    width: 'min(420px, calc(100vw - 32px))',
    background: 'rgba(15,23,42,0.98)',
    border: '1px solid rgba(251,191,36,0.42)',
    borderRadius: '8px',
    padding: '14px',
    boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
    color: '#f8fafc',
  },
  commandStripCompact: {
    maxWidth: '100%',
    padding: '4px 9px',
  },
  panelNarrow: {
    left: '8px',
    right: '8px',
    bottom: '64px',
    top: 'auto',
    transform: 'none',
    width: 'auto',
    maxHeight: 'min(360px, calc(100dvh - 164px))',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: { fontSize: '14px', fontWeight: 900, textTransform: 'uppercase' },
  subhead: { marginTop: '4px', color: '#facc15', fontSize: '12px', fontWeight: 800 },
  preview: {
    marginTop: '6px',
    color: '#cbd5e1',
    fontSize: '11px',
    lineHeight: 1.35,
  },
  targets: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', overflowY: 'auto', minHeight: 0 },
  targetRow: { display: 'grid', gridTemplateColumns: '28px 1fr auto 30px 30px', alignItems: 'center', gap: '8px', cursor: 'grab', borderRadius: '7px', padding: '3px', outline: 'none' },
  draggingRow: { opacity: 0.55, background: 'rgba(251,191,36,0.10)' },
  orderBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '999px', background: '#334155', color: '#f8fafc', fontSize: '11px', fontWeight: 900 },
  targetName: { fontSize: '12px', fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  targetMeta: { color: '#cbd5e1', fontSize: '11px', whiteSpace: 'nowrap' },
  iconButton: { border: '1px solid #475569', borderRadius: '6px', background: '#020617', color: '#f8fafc', width: '30px', height: '28px', cursor: 'pointer' },
  button: { marginTop: '12px', width: '100%', border: '0', borderRadius: '8px', padding: '10px', background: '#f97316', color: 'white', fontWeight: 900, cursor: 'pointer' },
};

export function BoardLayout({ onExitToLobby }: BoardLayoutProps) {
  const store = useGameStore();
  const { gameState, myTurn, phase, playerId } = store;
  const { isNarrow, isLaptop, isShort } = useBoardViewport();

  // Right panel split: 0-100 (gameLog height as %)
  const [splitPct, setSplitPct] = React.useState(50);
  const [isDragging, setIsDragging] = React.useState(false);
  const [pendingPlayAction, setPendingPlayAction] = React.useState<PendingPlayAction | null>(null);
  const [pendingMoveAction, setPendingMoveAction] = React.useState<PendingMoveAction | null>(null);
  const [pendingSpell, setPendingSpell] = React.useState<PendingSpell | null>(null);
  const [pendingHideCardId, setPendingHideCardId] = React.useState<string | null>(null);
  const [pendingHideRuneSelection, setPendingHideRuneSelection] = React.useState<PendingHideRuneSelection | null>(null);
  const [discardPileModal, setDiscardPileModal] = React.useState<{ playerId: string; isOpponent: boolean } | null>(null);
  const [pendingPowerRuneSelection, setPendingPowerRuneSelection] = React.useState<PendingPlayAction | null>(null);
  const [accelerateEnabled, setAccelerateEnabled] = React.useState(false);
  const [mobilePanelTab, setMobilePanelTab] = React.useState<'hand' | 'log' | 'chat'>('log');
  const [highlightedDamageUnitId, setHighlightedDamageUnitId] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const handleDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const handleMouseUp = () => {
      if (!isDragging) return;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const withPowerRuneDomains = useCallback((actionType: string, payload: Record<string, unknown>) => {
    if (!['PlayUnit', 'PlaySpell', 'PlayGear'].includes(actionType)) return payload;
    const cardInstanceId = payload.cardInstanceId as string | undefined;
    const card = cardInstanceId ? gameState?.allCards[cardInstanceId] : undefined;
    const def = card ? gameState?.cardDefinitions[card.cardId] : undefined;
    const domains = (def?.domains ?? []).filter(domain => RUNE_ICONS[domain]);
    const powerCost = def?.cost?.power ?? 0;
    if (!def || powerCost <= 0 || domains.length !== 2 || payload.powerRuneDomains) return payload;
    // This branch is now unreachable — dual-domain power cost selection is handled
    // by PowerRuneSelectionModal which sets powerRuneDomains before calling handleAction.
    // Kept for type-safety so the function still returns the correct shape.
    return payload;
  }, [gameState]);

  const handleAction = useCallback((actionType: string, payload: Record<string, unknown> = {}) => {
    const actionPayload = withPowerRuneDomains(actionType, payload);
    if (!actionPayload) return;
    const action: GameAction = {
      id: randomId(),
      type: actionType as GameAction['type'],
      playerId,
      payload: actionPayload,
      turn: gameState?.turn ?? 0,
      phase: gameState?.phase ?? 'Action',
      timestamp: Date.now(),
    };
    gameService.submitAction(action);
  }, [playerId, gameState, withPowerRuneDomains]);

  const queuePlayFromDrop = useCallback((cardInstanceId: string, battlefieldId: string, destinationKind: 'base' | 'battlefield') => {
    if (!gameState) return;
    const player = gameState.players[playerId];
    const card = gameState.allCards[cardInstanceId];
    const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
    const destination = gameState.battlefields.find(bf => bf.id === battlefieldId);
    const reject = (message: string) => store.addWarning(message);

    if (!player || !card || !def) return reject('Invalid play: card not found.');
    if (!myTurn || phase !== 'Action') return reject('Invalid play: you can only play cards during your Action phase.');
    if (card.ownerId !== playerId || card.location !== 'hand') return reject('Invalid play: card must be in your hand.');
    if (!destination) return reject('Invalid play: destination not found.');

    const runeCost = def.cost?.rune ?? 0;
    const availableRunes = getAvailableRunes(player, gameState.allCards);
    if (runeCost > availableRunes) {
      return reject(`Invalid play: ${def.name} costs ${runeCost} runes, but you only have ${availableRunes}.`);
    }
    const powerCost = def.cost?.power ?? 0;
    const powerDomains = (def.domains ?? []).filter((d: string) => RUNE_ICONS[d as Domain]);

    if (def.type === 'Unit') {
      const hasAccelerate = cardHasKeyword(def, 'Accelerate');
      const accelerateDomain = hasAccelerate ? runeDomain(def) : undefined;
      // Check if player has the required domain rune available for accelerate
      const availableDomains = getActiveRuneDomains(player, gameState.allCards, gameState.cardDefinitions);
      const canAccelerate = hasAccelerate && accelerateDomain && availableDomains.includes(accelerateDomain);

      setPendingMoveAction(null);
      setPendingHideCardId(null);
      setPendingPlayAction({
        actionType: 'PlayUnit',
        payload: { cardInstanceId, battlefieldId, hidden: false, accelerate: false },
        cardName: def.name,
        cardType: def.type,
        destinationLabel: destinationKind === 'base' ? 'Your Base' : destination.name,
        runeCost,
        availableRunes,
        powerCost,
        powerDomains,
        hasAccelerate,
        accelerateDomain,
      });
      return;
    }

    if (def.type === 'Gear') {
      if (destinationKind !== 'base' || battlefieldId !== getBaseBattlefieldId(playerId)) {
        return reject('Invalid play: gear must be dropped on your Base unless the card says otherwise.');
      }
      setPendingMoveAction(null);
      setPendingHideCardId(null);
      setPendingPlayAction({
        actionType: 'PlayGear',
        payload: { cardInstanceId, targetBattlefieldId: battlefieldId },
        cardName: def.name,
        cardType: def.type,
        destinationLabel: 'Your Base',
        runeCost,
        availableRunes,
        powerCost,
        powerDomains,
      });
      return;
    }

    reject('Invalid play: only Unit and Gear cards can be dragged onto the board.');
  }, [gameState, playerId, myTurn, phase, store]);

  const queueMoveFromDrop = useCallback((cardInstanceId: string, destinationBattlefieldId: string) => {
    if (!gameState) return;
    const card = gameState.allCards[cardInstanceId];
    const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
    const origin = card?.battlefieldId ? gameState.battlefields.find(bf => bf.id === card.battlefieldId) : undefined;
    const destination = gameState.battlefields.find(bf => bf.id === destinationBattlefieldId);
    const reject = (message: string) => store.addWarning(message);

    if (!card || !def) return reject('Invalid move: unit not found.');
    if (!myTurn || phase !== 'Action') return reject('Invalid move: you can only move units during your Action phase.');
    if (card.ownerId !== playerId) return reject('Invalid move: you can only move your own units.');
    if (def.type !== 'Unit') return reject('Invalid move: only units can move.');
    if (card.location !== 'battlefield' || !card.battlefieldId || !origin) return reject('Invalid move: unit is not at a battlefield or base.');
    if (!card.ready || card.exhausted) return reject('Invalid move: unit is exhausted.');
    if (!destination) return reject('Invalid move: destination not found.');
    if (card.battlefieldId === destinationBattlefieldId) return reject('Invalid move: unit is already there.');

    const playerBaseId = getBaseBattlefieldId(playerId);
    const fromIsBase = isBaseBattlefieldId(card.battlefieldId);
    const toIsBase = isBaseBattlefieldId(destinationBattlefieldId);
    if ((fromIsBase && card.battlefieldId !== playerBaseId) || (toIsBase && destinationBattlefieldId !== playerBaseId)) {
      return reject('Invalid move: units can only move to and from your Base.');
    }
    if (!fromIsBase && !toIsBase && !(def.keywords ?? []).includes('Ganking')) {
      return reject('Invalid move: unit needs Ganking to move battlefield to battlefield.');
    }

    const moveUnit: PendingMoveUnit = {
      unitId: card.instanceId,
      unitName: def.name,
      originBattlefieldId: card.battlefieldId,
      originLabel: getBattlefieldLabel(origin, playerId),
    };
    const destinationLabel = getBattlefieldLabel(destination, playerId);

    setPendingPlayAction(null);
    setPendingHideCardId(null);
    setPendingMoveAction(current => {
      if (!current || current.destinationBattlefieldId !== destinationBattlefieldId) {
        return { destinationBattlefieldId, destinationLabel, units: [moveUnit] };
      }
      if (current.units.some(unit => unit.unitId === card.instanceId)) {
        reject('Invalid move: unit is already staged.');
        return current;
      }
      return { ...current, units: [...current.units, moveUnit] };
    });
  }, [gameState, playerId, myTurn, phase, store]);

  const handleMoveDragStart = useCallback((cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/riftbound-unit', cardInstanceId);
  }, []);

  const confirmPendingPlay = useCallback((accelerate: boolean) => {
    if (!pendingPlayAction) return;
    // Dual-domain card with power cost → show rune selection modal
    if ((pendingPlayAction.powerDomains?.length ?? 0) === 2 && (pendingPlayAction.powerCost ?? 0) > 0) {
      setPendingPowerRuneSelection(pendingPlayAction);
      return;
    }
    const payload = {
      ...pendingPlayAction.payload,
      accelerate,
    };
    handleAction(pendingPlayAction.actionType, payload);
    setPendingPlayAction(null);
    setAccelerateEnabled(false);
  }, [handleAction, pendingPlayAction, setAccelerateEnabled]);

  const handlePowerRuneConfirm = useCallback((selectedDomains: Domain[]) => {
    if (!pendingPowerRuneSelection) return;
    const payload: Record<string, unknown> = { ...pendingPowerRuneSelection.payload, powerRuneDomains: selectedDomains };
    if (pendingPowerRuneSelection.selectedTargetIds?.length) {
      payload.targetId = pendingPowerRuneSelection.selectedTargetIds[0];
    }
    handleAction(pendingPowerRuneSelection.actionType, {
      ...payload,
    });
    setPendingPowerRuneSelection(null);
    setPendingPlayAction(null);
    // Also clear pendingSpell if this power rune selection was for a spell
    if (pendingPowerRuneSelection.actionType === 'PlaySpell') {
      setPendingSpell(null);
    }
  }, [handleAction, pendingPowerRuneSelection]);

  const confirmPendingMove = useCallback(() => {
    if (!pendingMoveAction) return;
    handleAction('MoveUnit', {
      cardInstanceIds: pendingMoveAction.units.map(unit => unit.unitId),
      toBattlefieldId: pendingMoveAction.destinationBattlefieldId,
    });
    setPendingMoveAction(null);
  }, [handleAction, pendingMoveAction]);

  const handlePass = useCallback(() => {
    gameService.pass();
  }, []);

  const handleAssignCombatDamage = useCallback((targetOrder: string[]) => {
    handleAction('AssignCombatDamage', { targetOrder });
  }, [handleAction]);

  const handleCardClick = useCallback((instanceId: string) => {
    store.setModalCard(instanceId);
  }, [store]);

  const handleHideCardClick = useCallback((cardInstanceId: string) => {
    if (!gameState) return;
    const card = gameState.allCards[cardInstanceId];
    const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
    if (!card || !def) return;
    if (!myTurn || phase !== 'Action') {
      store.addWarning('You can only hide cards during your Action phase.');
      return;
    }
    if (card.location !== 'hand' || card.ownerId !== playerId) {
      store.addWarning('Only cards in your hand can be hidden.');
      return;
    }
    if (!cardHasKeyword(def, 'Hidden')) {
      store.addWarning(`${def.name} does not have Hidden.`);
      return;
    }
    setPendingPlayAction(null);
    setPendingMoveAction(null);
    setPendingSpell(null);
    setPendingHideCardId(current => {
      const next = current === cardInstanceId ? null : cardInstanceId;
      if (next) store.addWarning(`Choose a battlefield you control to hide ${def.name}.`);
      return next;
    });
  }, [gameState, myTurn, phase, playerId, store]);

  const handleHideBattlefield = useCallback((battlefieldId: string) => {
    if (!gameState || !pendingHideCardId) return;
    const card = gameState.allCards[pendingHideCardId];
    const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
    const bf = gameState.battlefields.find(battlefield => battlefield.id === battlefieldId);
    if (!card || !def || !bf) return;
    if (bf.controllerId !== playerId) {
      store.addWarning('Choose a battlefield you control.');
      return;
    }
    const alreadyHidden = Object.values(gameState.allCards).some(hiddenCard =>
      hiddenCard.ownerId === playerId
      && hiddenCard.location === 'hidden'
      && hiddenCard.hiddenBattlefieldId === battlefieldId
    );
    if (alreadyHidden) {
      store.addWarning('You already have a hidden card at that battlefield.');
      return;
    }
    const availableDomains = getActiveRuneDomains(gameState.players[playerId], gameState.allCards, gameState.cardDefinitions);
    if (availableDomains.length === 0) {
      store.addWarning('You need an active rune to recycle before hiding a card.');
      return;
    }
    setPendingHideRuneSelection({ cardInstanceId: pendingHideCardId, battlefieldId, cardName: def.name });
  }, [gameState, pendingHideCardId, playerId, store]);

  const handleHideRuneConfirm = useCallback((selectedDomains: Domain[]) => {
    if (!pendingHideRuneSelection) return;
    const hideRuneDomain = selectedDomains[0];
    handleAction('HideCard', {
      cardInstanceId: pendingHideRuneSelection.cardInstanceId,
      battlefieldId: pendingHideRuneSelection.battlefieldId,
      hideRuneDomain,
    });
    store.addWarning(`Hid ${pendingHideRuneSelection.cardName}.`);
    setPendingHideRuneSelection(null);
    setPendingHideCardId(null);
  }, [handleAction, pendingHideRuneSelection, store]);

  const handlePlayHiddenCard = useCallback((cardInstanceId: string) => {
    if (!gameState) return;
    const card = gameState.allCards[cardInstanceId];
    const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
    if (!card || !def || card.location !== 'hidden' || card.ownerId !== playerId) return;
    if ((card.hiddenSinceTurn ?? Infinity) >= gameState.turn) {
      store.addWarning(`${def.name} cannot be played until a later turn.`);
      return;
    }
    const battlefieldId = card.hiddenBattlefieldId;
    if (!battlefieldId) return;
    if (def.type === 'Unit') {
      handleAction('PlayUnit', { cardInstanceId, battlefieldId, fromHidden: true, hidden: false, accelerate: false });
      return;
    }
    if (def.type === 'Spell') {
      const targeting = getSpellTargeting(def);
      setPendingHideCardId(null);
      setPendingSpell({ cardInstanceId, targetType: targeting.targetType, selectedTargetIds: [], fromHidden: true, hiddenBattlefieldId: battlefieldId, needsTarget: targeting.needsTarget });
      store.addWarning(targeting.needsTarget ? `Select targets for ${def.name}.` : `Cast ${def.name}?`);
      return;
    }
    if (def.type === 'Gear') {
      handleAction('PlayGear', { cardInstanceId, targetBattlefieldId: battlefieldId, fromHidden: true });
    }
  }, [gameState, playerId, handleAction, store]);

  // ─── Spell targeting handlers ─────────────────────────────────────────────────

  const handleSpellCardClick = useCallback((cardInstanceId: string) => {
    if (!gameState) return;

    // If a spell is already pending, clicking it again cancels
    if (pendingSpell && cardInstanceId === pendingSpell.cardInstanceId) {
      const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];
      store.addWarning(`Cancelled casting ${def?.name ?? 'spell'}.`);
      setPendingSpell(null);
      return;
    }
    if (pendingSpell) return; // different card clicked while spell pending — ignore

    const card = gameState.allCards[cardInstanceId];
    const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
    if (!card || !def) {

      return;
    }



    const showdown = gameState.showdown;
    const hasFocus = showdown?.focusPlayerId === playerId;
    const eligibility = canCastSpell(def, myTurn, phase, showdown ?? null, hasFocus);

    if (!eligibility.allowed) {
      store.addWarning(eligibility.reason ?? 'Cannot cast this spell now.');
      return;
    }

    const targeting = getSpellTargeting(def);
    setPendingHideCardId(null);
    setPendingSpell({ cardInstanceId, targetType: targeting.targetType, selectedTargetIds: [], needsTarget: targeting.needsTarget });
    store.addWarning(targeting.needsTarget
      ? `Select targets for ${def.name}.`
      : `Cast ${def.name}?`
    );
  }, [gameState, myTurn, phase, playerId, store]);

  const handleConfirmSpell = useCallback(() => {
    if (!pendingSpell) return;
    const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];
    const powerCost = def?.cost?.power ?? 0;
    const powerDomains = (def?.domains ?? []).filter((d: string) => RUNE_ICONS[d as Domain]);

    // Dual-domain card with power cost → show rune selection modal
    if (powerDomains.length === 2 && powerCost > 0) {
      setPendingPowerRuneSelection({
        actionType: 'PlaySpell',
        payload: {
          cardInstanceId: pendingSpell.cardInstanceId,
          fromHidden: pendingSpell.fromHidden,
        },
        cardName: def?.name ?? 'spell',
        cardType: def?.type ?? 'Spell',
        powerCost,
        powerDomains,
        targetType: pendingSpell.targetType,
        selectedTargetIds: pendingSpell.selectedTargetIds,
      });
      return;
    }

    const payload: Record<string, unknown> = { cardInstanceId: pendingSpell.cardInstanceId };
    if (pendingSpell.fromHidden) payload.fromHidden = true;
    if (pendingSpell.selectedTargetIds.length > 0) {
      payload.targetId = pendingSpell.selectedTargetIds[0];
    }

    handleAction('PlaySpell', payload);
    store.addWarning(`Cast ${def?.name ?? 'spell'}.`);
    setPendingSpell(null);
  }, [pendingSpell, handleAction, gameState, store]);

  const handleTargetSelect = useCallback((targetId: string) => {
    if (!pendingSpell) return;
    if (pendingSpell.selectedTargetIds.includes(targetId)) return;
    setPendingSpell({
      ...pendingSpell,
      selectedTargetIds: [...pendingSpell.selectedTargetIds, targetId],
    });
  }, [pendingSpell]);

  const handleRemoveTarget = useCallback((targetId: string) => {
    if (!pendingSpell) return;
    setPendingSpell({
      ...pendingSpell,
      selectedTargetIds: pendingSpell.selectedTargetIds.filter(id => id !== targetId),
    });
  }, [pendingSpell]);

  const handleCancelSpell = useCallback(() => {
    if (!pendingSpell) return;
    const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];
    store.addWarning(`Cancelled casting ${def?.name ?? 'spell'}.`);
    // Clear power rune selection too if this spell had dual-domain power cost
    if (pendingPowerRuneSelection?.actionType === 'PlaySpell') {
      setPendingPowerRuneSelection(null);
    }
    setPendingSpell(null);
  }, [pendingSpell, gameState, store, pendingPowerRuneSelection]);

  // Escape key closes the modal
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingSpell) {
        // If power rune modal is also showing (spell with dual-domain power cost),
        // clear both; otherwise just cancel the spell targeting
        if (pendingPowerRuneSelection?.actionType === 'PlaySpell') {
          setPendingPowerRuneSelection(null);
        }
        handleCancelSpell();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingSpell, pendingPowerRuneSelection, handleCancelSpell]);



  if (!gameState) {
    return (
      <div style={styles.connecting}>
        <h2 style={{ color: '#aaa' }}>Connecting to game...</h2>
      </div>
    );
  }

  const me = gameState.players[playerId];
  const opponent = Object.values(gameState.players).find(p => p.id !== playerId);
  const winner = gameState.winner ? gameState.players[gameState.winner] : null;
  const myCards = gameState.allCards;
  const cardDefs = gameState.cardDefinitions;

  const playerHandCards = me ? getPlayerCards(me, myCards, 'hand') : [];
  const opponentHandCount = opponent ? getPlayerCards(opponent, myCards, 'hand').length : 0;
  const isAIGame = Boolean(opponent?.id.startsWith('ai_') || opponent?.name.toLowerCase().includes('player 2'));
  const rightPanelLogPct = isAIGame ? 86 : splitPct;
  const canMoveUnits = myTurn && phase === 'Action';
  const damageAssignmentActive = Boolean(
    gameState.pendingCombatDamageAssignment &&
    gameState.pendingCombatDamageAssignment.assigningPlayerId === playerId &&
    gameState.showdown?.combatStep === 'AssignDamage'
  );
  const pendingMoveUnitIds = new Set(pendingMoveAction?.units.map(unit => unit.unitId) ?? []);
  const pendingMoveDestinationId = pendingMoveAction?.destinationBattlefieldId ?? null;
  const boardWithRightPanelStyle = {
    ...styles.boardWithRightPanel,
    ...(isNarrow ? styles.boardWithRightPanelNarrow : {}),
  };
  const boardGridStyle = {
    ...styles.boardGrid,
    ...(isNarrow ? styles.boardGridNarrow : {}),
    ...(isShort ? styles.boardGridShort : {}),
  };
  const rightPanelStyle = {
    ...styles.rightPanel,
    ...(isLaptop ? styles.rightPanelLaptop : {}),
    ...(isNarrow ? styles.rightPanelNarrow : {}),
  };
  const boardColumnStyle = {
    ...styles.boardColumn,
    ...(isNarrow ? styles.boardColumnNarrow : {}),
  };

  return (
    <div style={styles.board}>
      <WarningToasts warnings={store.warnings} onDismiss={store.dismissWarning} />

      {/* Board column (left) + right panel */}
      <div style={boardWithRightPanelStyle}>
        {/* Board column: top bar + main rows + action bar */}
        <div style={boardColumnStyle}>
          <TopBar
            player={me}
            opponent={opponent}
            allCards={myCards}
            cardDefs={cardDefs}
            turn={gameState.turn}
            phase={phase}
            myTurn={myTurn}
            compact={isNarrow}
          />

          {/* ========== MAIN FLEX COLUMN ========== */}
          <div style={isNarrow ? styles.mobileBoardScroll : styles.boardGridShell}>
          <div style={boardGridStyle}>

            {/* Row 1: Opponent Graveyard | Hand | Deck */}
            <div style={styles.opponentUtilityRow}>
              <DeckArea
                player={opponent}
                playerId={opponent?.id ?? ''}
                isOpponent={true}
                allCards={myCards}
                cardDefs={cardDefs}
                legionActiveCardIds={gameState.legionActiveCardIds}
                handCards={[]}
                opponentHandCount={opponentHandCount}
                compactCards={isShort || isNarrow}
                onGraveyardClick={() => opponent && setDiscardPileModal({ playerId: opponent.id, isOpponent: true })}
              />
            </div>

            {/* Row 2: Opponent Base | Legend | Champion */}
            <div style={styles.opponentZoneRow}>
              <ZoneRow
                player={opponent}
                playerId={opponent?.id ?? ''}
                isOpponent={true}
                allCards={myCards}
                cardDefs={cardDefs}
                legionActiveCardIds={gameState.legionActiveCardIds}
                battlefields={gameState.battlefields}
                isNarrow={isNarrow}
              />
            </div>

            {/* Row 3: Battlefields (flex-grow) */}
            <div style={styles.battlefieldRow}>
              <BattlefieldRow
                gameState={gameState}
                playerId={playerId}
                myTurn={myTurn}
                canMoveUnits={canMoveUnits}
                pendingMoveUnitIds={pendingMoveUnitIds}
                pendingMoveDestinationId={pendingMoveDestinationId}
                pendingSpell={pendingSpell}
                pendingHideCardId={pendingHideCardId}
                highlightedUnitId={highlightedDamageUnitId}
                isNarrow={isNarrow}
                onBattlefieldUnitClick={handleTargetSelect}
                onHideBattlefield={handleHideBattlefield}
                onPlayHiddenCard={handlePlayHiddenCard}
                handleAction={handleAction}
                onBattlefieldDrop={(cardInstanceId, battlefieldId) => queuePlayFromDrop(cardInstanceId, battlefieldId, 'battlefield')}
                onMoveDrop={queueMoveFromDrop}
                onMoveDragStart={handleMoveDragStart}
              />
            </div>

            {/* Row 4: Player Base | Legend | Champion */}
            <div style={styles.playerZoneRow}>
              <ZoneRow
                player={me}
                playerId={playerId}
                isOpponent={false}
                allCards={myCards}
                cardDefs={cardDefs}
                legionActiveCardIds={gameState.legionActiveCardIds}
                battlefields={gameState.battlefields}
                canMoveUnits={canMoveUnits}
                pendingMoveUnitIds={pendingMoveUnitIds}
                pendingMoveDestinationId={pendingMoveDestinationId}
                isNarrow={isNarrow}
                onBaseDrop={(cardInstanceId, baseBattlefieldId) => queuePlayFromDrop(cardInstanceId, baseBattlefieldId, 'base')}
                onMoveDrop={queueMoveFromDrop}
                onMoveDragStart={handleMoveDragStart}
              />
            </div>

            {/* Row 5: Player Deck | Hand | Graveyard */}
            <div style={styles.playerHandRow}>
              <DeckArea
                player={me}
                playerId={playerId}
                isOpponent={false}
                allCards={myCards}
                cardDefs={cardDefs}
                legionActiveCardIds={gameState.legionActiveCardIds}
                handCards={playerHandCards}
                opponentHandCount={0}
                myTurn={myTurn}
                phase={phase}
                hasShowdownFocus={gameState.showdown?.focusPlayerId === playerId}
                onCardClick={handleCardClick}
                pendingSpell={pendingSpell}
                onSpellCardClick={handleSpellCardClick}
                pendingHideCardId={pendingHideCardId}
                onHideCardClick={handleHideCardClick}
                compactCards={isShort || isNarrow}
                onGraveyardClick={() => me && setDiscardPileModal({ playerId, isOpponent: false })}
              />
            </div>

          </div>
          </div>

          {/* ========== BOTTOM ACTION BAR ========== */}
          <ActionBar
            myTurn={myTurn}
            phase={phase}
            canPass={(myTurn && phase === 'Action') || (phase === 'Showdown' && gameState.showdown?.focusPlayerId === playerId)}
            onPass={handlePass}
          />
        </div>

        {/* Right panel: game log (top) + draggable split + chat (bottom) */}
        {!isNarrow && <div ref={panelRef} style={rightPanelStyle}>
          <div style={{ flex: `0 0 ${rightPanelLogPct}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <GameLog messages={store.gameLog} />
          </div>

          {/* Drag handle */}
          <div
            style={{
              height: '8px',
              flexShrink: 0,
              cursor: 'row-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              transition: isDragging ? 'none' : 'background 0.15s',
            }}
            onMouseDown={handleDragStart}
          >
            <div style={{
              width: '40px',
              height: '3px',
              borderRadius: '2px',
              background: isDragging ? '#d4a843' : 'rgba(255,255,255,0.2)',
              transition: 'background 0.15s',
            }} />
          </div>

          <div style={{ flex: `0 0 ${100 - rightPanelLogPct}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <ChatBox playerId={playerId} opponentName={opponent?.name ?? 'Opponent'} compact={isAIGame} />
          </div>
        </div>}
      </div>

      {isNarrow && !damageAssignmentActive && (
        <MobileBottomPanel
          activeTab={mobilePanelTab}
          onTabChange={setMobilePanelTab}
          handCards={playerHandCards}
          cardDefs={cardDefs}
          gameLog={store.gameLog}
          playerId={playerId}
          opponentName={opponent?.name ?? 'Opponent'}
          pendingSpell={pendingSpell}
          onCardClick={handleCardClick}
          onSpellCardClick={handleSpellCardClick}
          pendingHideCardId={pendingHideCardId}
          onHideCardClick={handleHideCardClick}
        />
      )}

      {/* Card modal */}
      {store.showCardModal && store.modalCardId && (
        <CardModal
          cardId={store.modalCardId}
          cardDefs={cardDefs}
          onClose={() => store.setModalCard(null)}
        />
      )}

      {pendingPlayAction && (
        <PlayConfirmModal
          pending={pendingPlayAction}
          accelerateEnabled={accelerateEnabled}
          onToggleAccelerate={setAccelerateEnabled}
          onConfirm={() => {
            if (pendingPlayAction.actionType === 'PlayUnit') {
              confirmPendingPlay(accelerateEnabled);
            } else {
              confirmPendingPlay(false);
            }
          }}
          onCancel={() => {
            setPendingPlayAction(null);
            setAccelerateEnabled(false);
          }}
        />
      )}

      {pendingMoveAction && (
        <MoveConfirmModal
          pending={pendingMoveAction}
          onConfirm={confirmPendingMove}
          onCancel={() => setPendingMoveAction(null)}
        />
      )}

      {/* Spell targeting modal */}
      {pendingSpell && (
        <SpellTargetingModal
          pendingSpell={pendingSpell}
          allCards={gameState.allCards}
          cardDefs={cardDefs}
          onConfirm={handleConfirmSpell}
          onCancel={handleCancelSpell}
          onRemoveTarget={handleRemoveTarget}
        />
      )}

      {/* Discard pile modal */}
      {discardPileModal && (
        <DiscardPileModal
          title={discardPileModal.isOpponent ? "Opponent's Discard" : 'Your Discard'}
          discardPile={gameState.players[discardPileModal.playerId]?.discardPile ?? []}
          allCards={gameState.allCards}
          cardDefs={cardDefs}
          accentColor={discardPileModal.isOpponent ? '#ef4444' : '#22c55e'}
          onClose={() => setDiscardPileModal(null)}
        />
      )}

      {/* Power rune selection modal for dual-domain cards */}
      {pendingPowerRuneSelection && pendingPowerRuneSelection.powerDomains && (
        <PowerRuneSelectionModal
          cardName={pendingPowerRuneSelection.cardName}
          powerCost={pendingPowerRuneSelection.powerCost ?? 0}
          domains={pendingPowerRuneSelection.powerDomains}
          onConfirm={handlePowerRuneConfirm}
          onCancel={() => {
            setPendingPowerRuneSelection(null);
            setPendingPlayAction(null);
          }}
        />
      )}

      {pendingHideRuneSelection && (
        <PowerRuneSelectionModal
          cardName={`hide ${pendingHideRuneSelection.cardName}`}
          powerCost={1}
          domains={getActiveRuneDomains(me, myCards, cardDefs)}
          onConfirm={handleHideRuneConfirm}
          onCancel={() => setPendingHideRuneSelection(null)}
        />
      )}

      {/* Mulligan overlay */}
      {phase === 'Mulligan' && playerHandCards.length > 0 && (
        <MulliganOverlay
          playerId={playerId}
          hand={playerHandCards}
          allCards={myCards}
          cardDefs={cardDefs}
          isMyTurn={myTurn}
        />
      )}

      <CombatDamageAssignmentPanel
        gameState={gameState}
        playerId={playerId}
        isNarrow={isNarrow}
        onHoverTarget={setHighlightedDamageUnitId}
        onSubmit={handleAssignCombatDamage}
      />

      {gameState.phase === 'GameOver' && winner && (
        <GameOverModal
          winnerName={winner.name}
          isWinner={winner.id === playerId}
          onExitToLobby={onExitToLobby}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Styles
// ─────────────────────────────────────────
const warningStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    left: '50%',
    bottom: '68px',
    transform: 'translateX(-50%)',
    zIndex: 5000,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: 'min(360px, calc(100vw - 28px))',
    pointerEvents: 'none',
  },
  toast: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr 28px',
    alignItems: 'center',
    gap: '8px',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid rgba(250,204,21,0.38)',
    background: 'rgba(24,20,12,0.96)',
    color: '#fef3c7',
    boxShadow: '0 14px 36px rgba(0,0,0,0.35)',
    pointerEvents: 'auto',
  },
  icon: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#facc15',
    color: '#111827',
    fontWeight: 900,
    fontSize: '14px',
  },
  message: {
    fontSize: '12px',
    lineHeight: 1.35,
    fontWeight: 700,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  close: {
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.08)',
    color: '#fef3c7',
    fontWeight: 900,
    cursor: 'pointer',
  },
};

const gameOverStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 4000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.72)',
    backdropFilter: 'blur(6px)',
    padding: '24px',
  },
  modal: {
    width: 'min(420px, 100%)',
    borderRadius: '8px',
    border: '1px solid rgba(212,168,67,0.45)',
    background: '#111827',
    boxShadow: '0 22px 60px rgba(0,0,0,0.5)',
    padding: '28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  result: {
    fontSize: '14px',
    fontWeight: 900,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: '32px',
    lineHeight: 1,
    fontWeight: 900,
    color: '#f9fafb',
  },
  message: {
    fontSize: '15px',
    color: '#cbd5e1',
    marginBottom: '10px',
  },
  button: {
    width: '100%',
    height: '42px',
    border: 'none',
    borderRadius: '6px',
    background: '#d4a843',
    color: '#111827',
    fontSize: '14px',
    fontWeight: 900,
    cursor: 'pointer',
  },
};

const styles: Record<string, React.CSSProperties> = {
  board: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    width: '100%',
    background: 'linear-gradient(180deg, #0d1117 0%, #161b22 35%, #1a1a2e 65%, #0d1117 100%)',
    color: '#e8e8e8',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    overflow: 'hidden',
    position: 'relative',
    minHeight: 0,
  },
  connecting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#1a1a2e',
    color: '#aaa',
  },

  // Main grid
  boardGrid: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '3px 12px',
    gap: '6px',
    minHeight: 0,
  },
  boardGridShell: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    overflow: 'hidden',
  },
  boardGridNarrow: {
    padding: '3px 8px',
    gap: '5px',
    overflowY: 'auto',
    minWidth: '760px',
    width: '760px',
    height: '100%',
  },
  boardGridShort: {
    gap: '3px',
  },

  // Fallback row style; named rows below carry the weighted layout.
  row: {
    flex: '1 1 0',
    minHeight: 0,
    overflow: 'hidden',
  },
  opponentUtilityRow: {
    flex: '0.86 1 104px',
    display: 'flex',
    alignItems: 'stretch',
    minHeight: '72px',
    overflow: 'hidden',
  },
  opponentZoneRow: {
    flex: '1.22 1 148px',
    display: 'flex',
    alignItems: 'stretch',
    minHeight: '104px',
    overflow: 'hidden',
  },
  playerZoneRow: {
    flex: '1.32 1 158px',
    display: 'flex',
    alignItems: 'stretch',
    minHeight: '112px',
    overflow: 'hidden',
  },
  playerHandRow: {
    flex: '1.12 1 124px',
    display: 'flex',
    alignItems: 'stretch',
    minHeight: '96px',
    overflow: 'hidden',
  },

  // Battlefield row is weighted as the main stage.
  battlefieldRow: {
    flex: '1.28 1 142px',
    display: 'flex',
    alignItems: 'stretch',
    minHeight: 0,
    overflow: 'hidden',
    padding: '4px 0',
  },

  // Board with right panel side-by-side
  boardWithRightPanel: {
    display: 'flex',
    flex: 1,
    gap: '8px',
    overflow: 'hidden',
    minHeight: 0,
  },
  boardWithRightPanelNarrow: {
    overflow: 'hidden',
    gap: '4px',
  },
  // Board column: top bar + main rows + action bar (fills width minus right panel)
  boardColumn: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    minHeight: 0,
  },
  boardColumnNarrow: {
    width: '100%',
    minWidth: 0,
  },
  mobileBoardScroll: {
    flex: 1,
    minHeight: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  // Right panel: game log (top) + chat (bottom)
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '280px',
    flexShrink: 0,
    gap: '6px',
    padding: '6px 0',
    minHeight: 0,
    overflow: 'hidden',
  },
  rightPanelLaptop: {
    width: '240px',
  },
  rightPanelNarrow: {
    width: '100%',
    height: '160px',
    flexShrink: 0,
    padding: '0 8px 6px',
  },
};
