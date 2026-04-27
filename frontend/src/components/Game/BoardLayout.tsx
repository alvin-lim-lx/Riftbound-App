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
import { useGameStore } from '../../store/gameStore';
import { gameService } from '../../services/gameService';
import { ActionBar } from './ActionBar';
import { CardModal } from './CardModal';
import { PhaseIndicator, getPhaseLabel, getTurnPrompt } from './PhaseIndicator';
import { GameLog } from './GameLog';
import { ChatBox } from './ChatBox';
import { MulliganOverlay } from './MulliganOverlay';
import { CardArtView } from './CardArtView';
import { SpellTargetingModal, PendingSpell } from './SpellTargetingModal';
import type { GameAction, PlayerState, CardInstance, CardDefinition, Phase, Domain, BattlefieldState, SpellTargetType, SpellTargeting } from '../../shared/types';
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
    isNarrow: viewport.width < 900,
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

interface PendingPlayAction {
  actionType: 'PlayUnit' | 'PlayGear';
  payload: Record<string, unknown>;
  cardName: string;
  cardType: string;
  destinationLabel: string;
  runeCost: number;
  availableRunes: number;
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
}

function PlayerInfoBar({ player, isPlayer, allCards, cardDefs }: PlayerInfoBarProps) {
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
      borderColor: accentColor + '44',
      background: accentColor + '0d',
    }}>
      {/* Player name + score */}
      <div style={infoBarStyles.nameScore}>
        <div style={{ ...infoBarStyles.name, color: isYou ? '#e8e8e8' : '#ccc' }}>
          {player.name}
          {isYou && <span style={infoBarStyles.youTag}> (You)</span>}
        </div>
        <div style={infoBarStyles.scoreRow}>
          <span style={infoBarStyles.star}>★</span>
          <span style={{ ...infoBarStyles.scoreNum, color: '#d4a843' }}>{player.score}</span>
          <span style={{ ...infoBarStyles.sep }}>·</span>
          <span style={infoBarStyles.mana}>◆ {player.mana}/{player.maxMana}</span>
          {!isYou && <span style={infoBarStyles.sep}>·</span>}
          {!isYou && (
            <span style={{ fontSize: '11px', color: '#888' }}>
              ◆{player.mana}
            </span>
          )}
        </div>
      </div>

      {/* XP + charges for player */}
      {isYou && (
        <div style={infoBarStyles.resources}>
          <div style={infoBarStyles.resource}>
            <span style={infoBarStyles.xpIcon}>✦</span>
            <span style={infoBarStyles.xpVal}>{player.xp} XP</span>
          </div>
          {player.charges > 0 && (
            <div style={infoBarStyles.resource}>
              <span style={infoBarStyles.chargeIcon}>⚡</span>
              <span style={infoBarStyles.chargeVal}>{player.charges}</span>
            </div>
          )}
        </div>
      )}

      {/* Active runes */}
      <div style={infoBarStyles.runesSection}>
        <div style={infoBarStyles.runesLabel}>RUNES</div>
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
  nameScore: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
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
  scoreRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
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
  sep: {
    color: '#555',
    fontSize: '11px',
  },
  mana: {
    fontSize: '12px',
    color: '#e63946',
    fontWeight: 700,
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
  chargeIcon: {
    fontSize: '9px',
    color: '#60a5fa',
  },
  chargeVal: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#60a5fa',
  },
  runesSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '2px',
  },
  runesLabel: {
    fontSize: '8px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#666',
    fontWeight: 700,
    flexShrink: 0,
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
  onCardClick?: (instanceId: string) => void;
  pendingSpell?: PendingSpell | null;
  onSpellCardClick?: (instanceId: string) => void;
  canInteract?: boolean;
  maxCardHeight?: number;
}

function PlayerHandRow({ cards, cardDefs, onCardClick, pendingSpell, onSpellCardClick, canInteract = false, maxCardHeight = CARD_HEIGHTS.handMax }: PlayerHandRowProps) {
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
          const total = cards.length;
          const center = (total - 1) / 2;
          const offset = i - center;
          const yShift = Math.max(Math.abs(offset) * -8, -40);
          const rotate = offset * 2;
          const zIndex = total - Math.abs(offset);

          return (
            <div
              key={card.instanceId}
              draggable={canDrag}
              style={{
                transform: `translateY(${yShift}px) rotate(${rotate}deg)`,
                zIndex,
                transition: 'transform 0.2s ease',
                flexShrink: 1,
                position: 'relative',
                cursor: canDrag ? 'grab' : 'default',
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
                e.currentTarget.style.transform = `translateY(${yShift - 12}px) rotate(${rotate}deg) scale(1.04)`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = `translateY(${yShift}px) rotate(${rotate}deg)`;
              }}
            >
              {canDrag && <div style={handStyles.playableBadge}>Drag to play</div>}
              <CardArtView
                card={card}
                cardDef={def}
                isOpponent={false}
                showStats={true}
                showKeywords={true}
                size="md"
                maxHeight={maxCardHeight}
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
    alignItems: 'flex-end',
    gap: '2px',
    padding: '8px 8px 0',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
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
  isOpponent: boolean;
  size?: 'sm' | 'md' | 'lg';
  maxHeightPx?: number;
  canDragMove?: boolean;
  isPendingMove?: boolean;
  onMoveDragStart?: (cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => void;
}

function ZoneCard({ cardId, allCards, cardDefs, isOpponent, size = 'md', maxHeightPx, canDragMove = false, isPendingMove = false, onMoveDragStart }: ZoneCardProps) {
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
  battlefields?: BattlefieldState[];
  canMoveUnits?: boolean;
  pendingMoveUnitIds?: Set<string>;
  pendingMoveDestinationId?: string | null;
  onBaseDrop?: (cardInstanceId: string, baseBattlefieldId: string) => void;
  onMoveDrop?: (cardInstanceId: string, destinationBattlefieldId: string) => void;
  onMoveDragStart?: (cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => void;
}

function ZoneRow({ player, playerId, isOpponent, allCards, cardDefs, battlefields, canMoveUnits = false, pendingMoveUnitIds, pendingMoveDestinationId, onBaseDrop, onMoveDrop, onMoveDragStart }: ZoneRowProps) {
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
        <div style={{ ...zoneRowStyles.zoneLabel, color: '#7c3aed88' }}>BASE</div>
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
                  isOpponent={isOpponent}
                  size="md"
                  maxHeightPx={baseCardH}
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
                <ZoneCard key={id} cardId={id} allCards={allCards} cardDefs={cardDefs} isOpponent={isOpponent} size="md" maxHeightPx={legendCardH} />
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
  zoneLabel: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 700,
    flexShrink: 0,
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
  handCards: CardInstance[];
  opponentHandCount: number;
  myTurn?: boolean;
  phase?: Phase;
  onCardClick?: (instanceId: string) => void;
  pendingSpell?: PendingSpell | null;
  onSpellCardClick?: (instanceId: string) => void;
  compactCards?: boolean;
}

function DeckArea({ player, playerId, isOpponent, allCards, cardDefs, handCards, opponentHandCount, myTurn = false, phase, onCardClick, pendingSpell, onSpellCardClick, compactCards = false }: DeckAreaProps) {
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
      />

      {/* Hand (center) */}
      {isOpponent ? (
        <OpponentHandRow count={opponentHandCount} />
      ) : (
        <PlayerHandRow
          cards={handCards}
          cardDefs={cardDefs}
          onCardClick={onCardClick}
          pendingSpell={pendingSpell}
          onSpellCardClick={onSpellCardClick}
          canInteract={myTurn && phase === 'Action'}
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
// BattlefieldPanel — renders all battlefields in the center row
// (reused from BattlefieldZones, slightly restyled)
// ─────────────────────────────────────────
interface BattlefieldRowProps {
  gameState: import('../../shared/types').GameState;
  playerId: string;
  myTurn: boolean;
  canMoveUnits?: boolean;
  pendingMoveUnitIds?: Set<string>;
  pendingMoveDestinationId?: string | null;
  pendingSpell?: PendingSpell | null;
  onBattlefieldUnitClick?: (unitInstanceId: string) => void;
  handleAction?: (type: string, payload?: Record<string, unknown>) => void;
  onBattlefieldDrop?: (cardInstanceId: string, battlefieldId: string) => void;
  onMoveDrop?: (cardInstanceId: string, destinationBattlefieldId: string) => void;
  onMoveDragStart?: (cardInstanceId: string, event: React.DragEvent<HTMLDivElement>) => void;
}

function BattlefieldRow({ gameState, playerId, myTurn, canMoveUnits = false, pendingMoveUnitIds, pendingMoveDestinationId, pendingSpell, onBattlefieldUnitClick, handleAction, onBattlefieldDrop, onMoveDrop, onMoveDragStart }: BattlefieldRowProps) {
  const { battlefields, allCards, cardDefinitions } = gameState;
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = React.useState(0);

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
    return (
      <div style={bfRowStyles.empty}>
        No battlefields
      </div>
    );
  }

  return (
    <div ref={rowRef} style={bfRowStyles.container}>
      {centerBattlefields.map(bf => {
        const myUnits = bf.units.map(id => allCards[id]).filter(c => c && c.ownerId === playerId);
        const enemyUnits = bf.units.map(id => allCards[id]).filter(c => c && c.ownerId !== playerId);
        const isControlled = bf.controllerId === playerId;
        const bfColor = BF_COLORS[bf.cardId] ?? '#374151';
        const canAttack = myTurn && myUnits.some(u => u.ready && !u.exhausted);

        return (
          <div
            key={bf.id}
            style={{
              ...bfRowStyles.bfPanel,
              ...((onBattlefieldDrop || onMoveDrop) ? bfRowStyles.dropPanel : {}),
              ...(pendingMoveDestinationId === bf.id ? bfRowStyles.pendingDropPanel : {}),
              borderColor: bfColor + '55',
              flexDirection: 'row',
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0, overflow: 'hidden', padding: '8px' }}>
              <div style={bfRowStyles.rowLabel}>Your</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {myUnits.length === 0 ? (
                  <div style={{ ...bfRowStyles.emptyState, fontSize: '11px' }}>—</div>
                ) : (
                  myUnits.map(unit => {
                    const def = cardDefinitions[unit.cardId];
                    const might = unit.currentStats.might ?? unit.stats.might ?? 0;
                    const health = unit.currentStats.health ?? unit.stats.health ?? 1;
                    const isReady = unit.ready && !unit.exhausted;
                    const unitTransform = unit.exhausted ? 'rotate(90deg) scale(0.95)' : 'rotate(0deg) scale(1)';
                    const canDragMove = canMoveUnits && isReady;
                    const isPendingMove = pendingMoveUnitIds?.has(unit.instanceId) ?? false;
                    const isSpellTarget = pendingSpell?.targetType === 'unit' && pendingSpell.selectedTargetIds.includes(unit.instanceId);
                    const isTargetable = pendingSpell?.targetType === 'unit';
                    return (
                      <div
                        key={unit.instanceId}
                        draggable={canDragMove}
                        onDragStart={e => {
                          if (!canDragMove) return;
                          onMoveDragStart?.(unit.instanceId, e);
                        }}
                        onClick={() => isTargetable && onBattlefieldUnitClick?.(unit.instanceId)}
                        style={{
                          ...bfRowStyles.unitChip,
                          borderColor: isSpellTarget ? '#fbbf24' : '#22c55e',
                          boxShadow: isSpellTarget ? '0 0 10px rgba(251,191,36,0.6)' : '0 1px 3px rgba(0,0,0,0.2)',
                          opacity: isPendingMove ? 0.72 : isReady ? 1 : 0.6,
                          transform: unitTransform,
                          transformOrigin: 'center',
                          cursor: isTargetable ? 'crosshair' : canDragMove ? 'grab' : 'default',
                          outline: isSpellTarget ? '2px solid rgba(251,191,36,0.9)' : isPendingMove ? '2px solid rgba(251,191,36,0.9)' : 'none',
                          outlineOffset: '2px',
                        }}
                        title={def?.name}
                      >
                        <div style={bfRowStyles.unitName}>{def?.name ?? '?'}</div>
                        {isSpellTarget && <div style={bfRowStyles.targetHint}>Target</div>}
                        <div style={bfRowStyles.unitStats}>
                          <span style={{ ...bfRowStyles.statNum, color: '#e63946' }}>{might}</span>
                          <span style={{ ...bfRowStyles.statNum, color: '#e8e8e8' }}>♦{health}</span>
                        </div>
                        <div style={{ ...bfRowStyles.readyDot, background: isReady ? '#22c55e' : '#555' }} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Center: battlefield card art */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minWidth: '132px', padding: '4px 8px', gap: '2px' }}>
              {canAttack && <div style={bfRowStyles.actionHint}>Can attack</div>}
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
              {bf.controllerId && (
                <span style={{ fontSize: '9px', color: bf.controllerId === playerId ? '#22c55e' : '#ef4444' }}>
                  {bf.controllerId === playerId ? 'You' : 'Enemy'}
                </span>
              )}
              {bf.scoringPlayerId && (
                <span style={{ fontSize: '9px', color: '#d4a843' }}>● Scoring</span>
              )}
              {canAttack && (
                <button style={{ ...bfRowStyles.attackBtn, fontSize: '11px', padding: '4px 12px' }}>
                  Attack
                </button>
              )}
            </div>

            {/* Right: opponent units */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0, overflow: 'hidden', padding: '8px' }}>
              <div style={bfRowStyles.rowLabel}>Enemy</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {enemyUnits.length === 0 ? (
                  <div style={{ ...bfRowStyles.emptyState, fontSize: '11px' }}>—</div>
                ) : (
                  enemyUnits.map(unit => {
                    const def = cardDefinitions[unit.cardId];
                    const might = unit.currentStats.might ?? unit.stats.might ?? 0;
                    const health = unit.currentStats.health ?? unit.stats.health ?? 1;
                    const isReady = unit.ready && !unit.exhausted;
                    const isSpellTarget = pendingSpell?.targetType === 'unit' && pendingSpell.selectedTargetIds.includes(unit.instanceId);
                    const isTargetable = pendingSpell?.targetType === 'unit';
                    const unitTransform = unit.exhausted ? 'rotate(90deg) scale(0.95)' : 'rotate(0deg) scale(1)';
                    return (
                      <div
                        key={unit.instanceId}
                        style={{
                          ...bfRowStyles.unitChip,
                          borderColor: isSpellTarget ? '#fbbf24' : '#ef4444',
                          boxShadow: isSpellTarget ? '0 0 10px rgba(251,191,36,0.6)' : '0 1px 3px rgba(0,0,0,0.2)',
                          opacity: isReady ? 1 : 0.6,
                          transform: unitTransform,
                          transformOrigin: 'center',
                          cursor: isTargetable ? 'crosshair' : 'pointer',
                        }}
                        onClick={() => isTargetable && onBattlefieldUnitClick?.(unit.instanceId)}
                        title={def?.name}
                      >
                        <div style={bfRowStyles.unitName}>{def?.name ?? '?'}</div>
                        {isSpellTarget ? (
                          <div style={bfRowStyles.targetHint}>Target</div>
                        ) : isTargetable ? (
                          <div style={bfRowStyles.targetHint}>Select target</div>
                        ) : null}
                        <div style={bfRowStyles.unitStats}>
                          <span style={{ ...bfRowStyles.statNum, color: '#e63946' }}>{might}</span>
                          <span style={{ ...bfRowStyles.statNum, color: '#e8e8e8' }}>♦{health}</span>
                        </div>
                        <div style={{ ...bfRowStyles.readyDot, background: isReady ? '#22c55e' : '#555' }} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
  dropPanel: {
    outline: '1px dashed rgba(255,255,255,0.16)',
    outlineOffset: '-4px',
  },
  pendingDropPanel: {
    boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.48), 0 2px 8px rgba(0,0,0,0.2)',
    background: 'rgba(251,191,36,0.08)',
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
  scoring: {
    fontSize: '10px',
    color: '#d4a843',
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
}

function TopBar({ player, opponent, allCards, cardDefs, turn, phase, myTurn }: TopBarProps) {
  const prompt = getTurnPrompt(phase, myTurn);

  return (
    <div style={topBarStyles.bar}>
      {/* Left: player info */}
      <PlayerInfoBar
        player={player}
        isPlayer={true}
        allCards={allCards}
        cardDefs={cardDefs}
      />

      {/* Center: turn tracker */}
      <div style={topBarStyles.center}>
        <div style={topBarStyles.commandStrip}>
          <span style={{ ...topBarStyles.commandPhase, color: myTurn ? '#fdba74' : '#cbd5e1' }}>
            {myTurn ? 'You' : 'AI'} - {getPhaseLabel(phase)}
          </span>
          <span style={topBarStyles.commandPrompt}>{prompt}</span>
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
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
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
  onConfirm,
  onCancel,
}: {
  pending: PendingPlayAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
          <strong>{pending.runeCost}</strong>
        </div>
        <div style={confirmStyles.costRow}>
          <span>Available runes</span>
          <strong>{pending.availableRunes}</strong>
        </div>
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
  },
  dialog: {
    width: 'min(360px, calc(100vw - 32px))',
    padding: '18px',
    borderRadius: '8px',
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
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

export function BoardLayout() {
  const store = useGameStore();
  const { gameState, myTurn, phase, playerId } = store;
  const { isNarrow, isShort } = useBoardViewport();

  // Right panel split: 0-100 (gameLog height as %)
  const [splitPct, setSplitPct] = React.useState(50);
  const [isDragging, setIsDragging] = React.useState(false);
  const [pendingPlayAction, setPendingPlayAction] = React.useState<PendingPlayAction | null>(null);
  const [pendingMoveAction, setPendingMoveAction] = React.useState<PendingMoveAction | null>(null);
  const [pendingSpell, setPendingSpell] = React.useState<PendingSpell | null>(null);
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

    const selected: Domain[] = [];
    for (let i = 0; i < powerCost; i++) {
      const response = window.prompt(
        `Choose power rune ${i + 1}/${powerCost} for ${def.name}: ${domains[0]} or ${domains[1]}`,
        domains[i % 2]
      );
      if (!response) return null;
      const match = domains.find(domain => domain.toLowerCase() === response.trim().toLowerCase());
      if (!match) return null;
      selected.push(match);
    }
    return { ...payload, powerRuneDomains: selected };
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
    const reject = (message: string) => store.addLog(message);

    if (!player || !card || !def) return reject('Invalid play: card not found.');
    if (!myTurn || phase !== 'Action') return reject('Invalid play: you can only play cards during your Action phase.');
    if (card.ownerId !== playerId || card.location !== 'hand') return reject('Invalid play: card must be in your hand.');
    if (!destination) return reject('Invalid play: destination not found.');

    const runeCost = def.cost?.rune ?? 0;
    const availableRunes = getAvailableRunes(player, gameState.allCards);
    if (runeCost > availableRunes) {
      return reject(`Invalid play: ${def.name} costs ${runeCost} runes, but you only have ${availableRunes}.`);
    }

    if (def.type === 'Unit') {
      setPendingMoveAction(null);
      setPendingPlayAction({
        actionType: 'PlayUnit',
        payload: { cardInstanceId, battlefieldId, hidden: false, accelerate: false },
        cardName: def.name,
        cardType: def.type,
        destinationLabel: destinationKind === 'base' ? 'Your Base' : destination.name,
        runeCost,
        availableRunes,
      });
      return;
    }

    if (def.type === 'Gear') {
      if (destinationKind !== 'base' || battlefieldId !== getBaseBattlefieldId(playerId)) {
        return reject('Invalid play: gear must be dropped on your Base unless the card says otherwise.');
      }
      setPendingMoveAction(null);
      setPendingPlayAction({
        actionType: 'PlayGear',
        payload: { cardInstanceId, targetBattlefieldId: battlefieldId },
        cardName: def.name,
        cardType: def.type,
        destinationLabel: 'Your Base',
        runeCost,
        availableRunes,
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
    const reject = (message: string) => store.addLog(message);

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

  const confirmPendingPlay = useCallback(() => {
    if (!pendingPlayAction) return;
    handleAction(pendingPlayAction.actionType, pendingPlayAction.payload);
    setPendingPlayAction(null);
  }, [handleAction, pendingPlayAction]);

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

  const handleCardClick = useCallback((instanceId: string) => {
    store.setModalCard(instanceId);
  }, [store]);

  // ─── Spell targeting handlers ─────────────────────────────────────────────────

  const handleSpellCardClick = useCallback((cardInstanceId: string) => {
    if (!gameState) return;

    // If a spell is already pending, clicking it again cancels
    if (pendingSpell && cardInstanceId === pendingSpell.cardInstanceId) {
      const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];
      store.addLog(`Cancelled casting ${def?.name ?? 'spell'}.`);
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
      store.addLog(eligibility.reason ?? 'Cannot cast this spell now.');
      return;
    }

    const targeting = getSpellTargeting(def);
    setPendingSpell({ cardInstanceId, targetType: targeting.targetType, selectedTargetIds: [] });
    store.addLog(targeting.needsTarget
      ? `Select targets for ${def.name}.`
      : `Cast ${def.name}?`
    );
  }, [gameState, myTurn, phase, playerId, store]);

  const handleConfirmSpell = useCallback(() => {
    if (!pendingSpell) return;
    const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];

    const payload: Record<string, unknown> = { cardInstanceId: pendingSpell.cardInstanceId };
    if (pendingSpell.selectedTargetIds.length > 0) {
      payload.targetId = pendingSpell.selectedTargetIds[0];
    }

    handleAction('PlaySpell', payload);
    store.addLog(`Cast ${def?.name ?? 'spell'}.`);
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
    store.addLog(`Cancelled casting ${def?.name ?? 'spell'}.`);
    setPendingSpell(null);
  }, [pendingSpell, gameState, store]);

  // Escape key closes the modal
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingSpell) {
        handleCancelSpell();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingSpell, handleCancelSpell]);



  if (!gameState) {
    return (
      <div style={styles.connecting}>
        <h2 style={{ color: '#aaa' }}>Connecting to game...</h2>
      </div>
    );
  }

  const me = gameState.players[playerId];
  const opponent = Object.values(gameState.players).find(p => p.id !== playerId);
  const myCards = gameState.allCards;
  const cardDefs = gameState.cardDefinitions;

  const playerHandCards = me ? getPlayerCards(me, myCards, 'hand') : [];
  const opponentHandCount = opponent ? getPlayerCards(opponent, myCards, 'hand').length : 0;
  const isAIGame = Boolean(opponent?.id.startsWith('ai_') || opponent?.name.toLowerCase().includes('player 2'));
  const rightPanelLogPct = isAIGame ? 68 : splitPct;
  const canMoveUnits = myTurn && phase === 'Action';
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
    ...(isNarrow ? styles.rightPanelNarrow : {}),
  };

  return (
    <div style={styles.board}>
      {/* Board column (left) + right panel */}
      <div style={boardWithRightPanelStyle}>
        {/* Board column: top bar + main rows + action bar */}
        <div style={styles.boardColumn}>
          <TopBar
            player={me}
            opponent={opponent}
            allCards={myCards}
            cardDefs={cardDefs}
            turn={gameState.turn}
            phase={phase}
            myTurn={myTurn}
          />

          {/* ========== MAIN FLEX COLUMN ========== */}
          <div style={boardGridStyle}>

            {/* Row 1: Opponent Graveyard | Hand | Deck */}
            <div style={styles.opponentUtilityRow}>
              <DeckArea
                player={opponent}
                playerId={opponent?.id ?? ''}
                isOpponent={true}
                allCards={myCards}
                cardDefs={cardDefs}
                handCards={[]}
                opponentHandCount={opponentHandCount}
                compactCards={isShort || isNarrow}
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
                battlefields={gameState.battlefields}
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
                onBattlefieldUnitClick={handleTargetSelect}
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
                battlefields={gameState.battlefields}
                canMoveUnits={canMoveUnits}
                pendingMoveUnitIds={pendingMoveUnitIds}
                pendingMoveDestinationId={pendingMoveDestinationId}
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
                handCards={playerHandCards}
                opponentHandCount={0}
                myTurn={myTurn}
                phase={phase}
                onCardClick={handleCardClick}
                pendingSpell={pendingSpell}
                onSpellCardClick={handleSpellCardClick}
                compactCards={isShort || isNarrow}
              />
            </div>

          </div>

          {/* ========== BOTTOM ACTION BAR ========== */}
          <ActionBar myTurn={myTurn} phase={phase} onPass={handlePass} />
        </div>

        {/* Right panel: game log (top) + draggable split + chat (bottom) */}
        <div ref={panelRef} style={rightPanelStyle}>
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
        </div>
      </div>

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
          onConfirm={confirmPendingPlay}
          onCancel={() => setPendingPlayAction(null)}
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
    </div>
  );
}

// ─────────────────────────────────────────
// Styles
// ─────────────────────────────────────────
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
  boardGridNarrow: {
    padding: '3px 8px',
    gap: '5px',
    overflowY: 'auto',
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
    flexDirection: 'column',
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
  // Right panel: game log (top) + chat (bottom)
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '220px',
    flexShrink: 0,
    gap: '6px',
    padding: '6px 0',
    minHeight: 0,
    overflow: 'hidden',
  },
  rightPanelNarrow: {
    width: '100%',
    height: '160px',
    flexShrink: 0,
    padding: '0 8px 6px',
  },
};
