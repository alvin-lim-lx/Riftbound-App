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
import { PhaseIndicator } from './PhaseIndicator';
import { GameLog } from './GameLog';
import { MulliganOverlay } from './MulliganOverlay';
import { CardArtView } from './CardArtView';
import type { GameAction, PlayerState, CardInstance, CardDefinition, Phase } from '../../shared/types';
import { CARDS } from '../../shared/cards';
import { randomId } from '../../utils/helpers';

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

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

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

    if (c.location === 'battlefield' || c.location === 'legend' || c.location === 'championZone') {
      if (def.type === 'Battlefield') baseIds.push(c.instanceId);
      else if (def.type === 'Unit' && def.superType === 'Champion') championIds.push(c.instanceId);
      else if (def.type === 'Legend') legendIds.push(c.instanceId);
    }
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
            ◆
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
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 900,
    flexShrink: 0,
    transition: 'all 0.2s ease',
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
}

function PlayerHandRow({ cards, cardDefs, onCardClick }: PlayerHandRowProps) {
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
          const total = cards.length;
          const center = (total - 1) / 2;
          const offset = i - center;
          const yShift = Math.max(Math.abs(offset) * -8, -40);
          const rotate = offset * 2;
          const zIndex = total - Math.abs(offset);

          return (
            <div
              key={card.instanceId}
              style={{
                transform: `translateY(${yShift}px) rotate(${rotate}deg)`,
                zIndex,
                transition: 'transform 0.2s ease',
                flexShrink: 1,
              }}
            >
              <CardArtView
                card={card}
                cardDef={def}
                isOpponent={false}
                showStats={true}
                showKeywords={true}
                size="md"
                maxHeight={80}
                onClick={() => onCardClick?.(card.instanceId)}
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
    flexWrap: 'wrap',
    justifyContent: 'center',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  cardBack: {
    width: '44px',
    height: '60px',
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
    gap: '0px',
    padding: '0 8px',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
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
}

function ZoneCard({ cardId, allCards, cardDefs, isOpponent, size = 'md', maxHeightPx }: ZoneCardProps) {
  const card = allCards[cardId];
  if (!card) return null;
  const def = cardDefs[card.cardId];

  return (
    <div style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
}

function ZoneRow({ player, playerId, isOpponent, allCards, cardDefs }: ZoneRowProps) {
  if (!player) return null;

  const baseRef = React.useRef<HTMLDivElement>(null);
  const legendRef = React.useRef<HTMLDivElement>(null);
  const champRef = React.useRef<HTMLDivElement>(null);
  const [baseH, setBaseH] = React.useState(60);
  const [legendH, setLegendH] = React.useState(60);
  const [champH, setChampH] = React.useState(60);

  React.useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const id = entry.target === baseRef.current ? 'base'
          : entry.target === legendRef.current ? 'legend'
          : 'champ';
        const h = entry.contentRect.height;
        if (id === 'base') setBaseH(h);
        else if (id === 'legend') setLegendH(h);
        else setChampH(h);
      }
    });
    if (baseRef.current) observer.observe(baseRef.current);
    if (legendRef.current) observer.observe(legendRef.current);
    if (champRef.current) observer.observe(champRef.current);
    // Fire immediately with current sizes
    if (baseRef.current) setBaseH(baseRef.current.clientHeight);
    if (legendRef.current) setLegendH(legendRef.current.clientHeight);
    if (champRef.current) setChampH(champRef.current.clientHeight);
    return () => observer.disconnect();
  }, []);

  const { baseIds, championIds, legendIds } = partitionPlayerZones(
    playerId, allCards, cardDefs
  );

  const accentColor = isOpponent ? '#ef4444' : '#22c55e';
  const labelColor = isOpponent ? '#ef444488' : '#22c55e88';
  const borderColor = isOpponent ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';
  const bg = isOpponent ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)';

  return (
    <div style={{
      ...zoneRowStyles.row,
      background: bg,
      borderColor: borderColor,
    }}>
      {/* Base */}
      <div style={zoneRowStyles.zone}>
        <div style={{ ...zoneRowStyles.zoneLabel, color: '#7c3aed88' }}>BASE</div>
        <div ref={baseRef} style={zoneRowStyles.cardArea}>
          {baseIds.length > 0 ? (
            baseIds.map(id => (
              <ZoneCard key={id} cardId={id} allCards={allCards} cardDefs={cardDefs} isOpponent={isOpponent} size="md" maxHeightPx={baseH} />
            ))
          ) : (
            <div style={{ ...zoneRowStyles.empty, borderColor: '#7c3aed33' }}>
              <span style={{ color: '#7c3aed33', fontSize: '20px' }}>◇</span>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={zoneRowStyles.zone}>
        <div style={{ ...zoneRowStyles.zoneLabel, color: '#d4a84388' }}>LEGEND</div>
        <div ref={legendRef} style={zoneRowStyles.cardArea}>
          {legendIds.length > 0 ? (
            legendIds.map(id => (
              <ZoneCard key={id} cardId={id} allCards={allCards} cardDefs={cardDefs} isOpponent={isOpponent} size="md" maxHeightPx={legendH} />
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
              <ZoneCard key={id} cardId={id} allCards={allCards} cardDefs={cardDefs} isOpponent={isOpponent} size="md" maxHeightPx={champH} />
            ))
          ) : (
            <div style={{ ...zoneRowStyles.empty, borderColor: '#3b82f633' }}>
              <span style={{ color: '#3b82f633', fontSize: '20px' }}>★</span>
            </div>
          )}
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
    gap: '12px',
    padding: '2px 16px',
    borderRadius: '6px',
    border: '1px solid',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
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
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  empty: {
    flex: 1,
    minHeight: 0,
    border: '1px dashed',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '64px',
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
  handCards: CardInstance[];    // already-filtered hand cards
  opponentHandCount: number;    // just the count (hidden)
}

function DeckArea({ player, playerId, isOpponent, allCards, cardDefs, handCards, opponentHandCount }: DeckAreaProps) {
  if (!player) return null;

  const accentColor = isOpponent ? '#ef4444' : '#22c55e';

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
    return () => observer.disconnect();
  }, []);

  // Reserve ~44px for labels + count text; rest for card art
  const cardMaxH = Math.max(20, rowH - 44);

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
        <PlayerHandRow cards={handCards} cardDefs={cardDefs} onCardClick={undefined} />
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
    gap: '16px',
    padding: '6px 16px',
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
  selectedTargetId: string | null;
  selectTarget: (id: string | null) => void;
  handleAction: (type: string, payload?: Record<string, unknown>) => void;
}

function BattlefieldRow({ gameState, playerId, myTurn, selectedTargetId, selectTarget, handleAction }: BattlefieldRowProps) {
  const { battlefields, allCards, cardDefinitions } = gameState;

  if (!battlefields.length) {
    return (
      <div style={bfRowStyles.empty}>
        No battlefields
      </div>
    );
  }

  return (
    <div style={bfRowStyles.container}>
      {battlefields.map(bf => {
        const myUnits = bf.units.map(id => allCards[id]).filter(c => c && c.ownerId === playerId);
        const enemyUnits = bf.units.map(id => allCards[id]).filter(c => c && c.ownerId !== playerId);
        const isControlled = bf.controllerId === playerId;
        const bfColor = BF_COLORS[bf.cardId] ?? '#374151';
        const canAttack = myTurn && myUnits.some(u => u.ready && !u.exhausted);

        return (
          <div key={bf.id} style={{ ...bfRowStyles.bfPanel, borderColor: bfColor + '55', flexDirection: 'row' }}>
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
                    return (
                      <div
                        key={unit.instanceId}
                        style={{
                          ...bfRowStyles.unitChip,
                          borderColor: '#22c55e',
                          opacity: isReady ? 1 : 0.6,
                        }}
                        title={def?.name}
                      >
                        <div style={bfRowStyles.unitName}>{def?.name ?? '?'}</div>
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minWidth: '80px', padding: '4px 8px', gap: '2px' }}>
              <CardArtView
                card={{ instanceId: bf.id, cardId: bf.cardId, ownerId: '', location: 'battlefield', currentStats: { might: 0, health: 0 }, stats: { might: 0, health: 0 }, ready: false, exhausted: false, counters: {}, attachments: [], facing: 'up', owner_hidden: false }}
                cardDef={CARDS[bf.cardId] ?? cardDefinitions[bf.cardId]}
                isOpponent={false}
                showStats={false}
                showKeywords={false}
                size="sm"
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
                    const isTarget = selectedTargetId === unit.instanceId;
                    return (
                      <div
                        key={unit.instanceId}
                        style={{
                          ...bfRowStyles.unitChip,
                          borderColor: isTarget ? '#fbbf24' : '#ef4444',
                          opacity: isReady ? 1 : 0.6,
                          cursor: 'pointer',
                        }}
                        onClick={() => selectTarget(unit.instanceId)}
                        title={def?.name}
                      >
                        <div style={bfRowStyles.unitName}>{def?.name ?? '?'}</div>
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
    gap: '12px',
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
    minWidth: '200px',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    minHeight: 0,
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
    padding: '5px 8px',
    background: 'rgba(20,20,35,0.8)',
    border: '1px solid',
    borderRadius: '6px',
    minWidth: '60px',
    transition: 'all 0.15s ease',
  },
  unitName: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#e8e8e8',
    maxWidth: '68px',
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
        <PhaseIndicator phase={phase} turn={turn} myTurn={myTurn} />
        <div style={topBarStyles.turnRow}>
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
    gap: '3px',
    flexShrink: 0,
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
export function BoardLayout() {
  const store = useGameStore();
  const { gameState, myTurn, phase, playerId } = store;

  const handleAction = useCallback((actionType: string, payload: Record<string, unknown> = {}) => {
    const action: GameAction = {
      id: randomId(),
      type: actionType as GameAction['type'],
      playerId,
      payload,
      turn: gameState?.turn ?? 0,
      phase: gameState?.phase ?? 'FirstMain',
      timestamp: Date.now(),
    };
    gameService.submitAction(action);
  }, [playerId, gameState]);

  const handlePass = useCallback(() => {
    gameService.pass();
  }, []);

  const handleCardClick = useCallback((instanceId: string) => {
    store.setModalCard(instanceId);
  }, [store]);

  // DEBUG: track phase changes
  const prevPhaseRef = React.useRef(phase);
  React.useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      console.log(`[BoardLayout] phase changed: ${prevPhaseRef.current} -> ${phase}`);
      prevPhaseRef.current = phase;
    }
  });

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

  return (
    <div style={styles.board}>
      {/* ========== TOP BAR ========== */}
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
      <div style={styles.boardGrid}>

        {/* Row 1: Opponent Graveyard | Hand | Deck */}
        <div style={styles.row}>
          <DeckArea
            player={opponent}
            playerId={opponent?.id ?? ''}
            isOpponent={true}
            allCards={myCards}
            cardDefs={cardDefs}
            handCards={[]}
            opponentHandCount={opponentHandCount}
          />
        </div>

        {/* Row 2: Opponent Base | Legend | Champion */}
        <div style={styles.row}>
          <ZoneRow
            player={opponent}
            playerId={opponent?.id ?? ''}
            isOpponent={true}
            allCards={myCards}
            cardDefs={cardDefs}
          />
        </div>

        {/* Row 3: Battlefields (flex-grow) */}
        <div style={styles.battlefieldRow}>
          <BattlefieldRow
            gameState={gameState}
            playerId={playerId}
            myTurn={myTurn}
            selectedTargetId={store.selectedTargetId}
            selectTarget={store.selectTarget}
            handleAction={handleAction}
          />
        </div>

        {/* Row 4: Player Base | Legend | Champion */}
        <div style={styles.row}>
          <ZoneRow
            player={me}
            playerId={playerId}
            isOpponent={false}
            allCards={myCards}
            cardDefs={cardDefs}
          />
        </div>

        {/* Row 5: Player Deck | Hand | Graveyard */}
        <div style={styles.row}>
          <DeckArea
            player={me}
            playerId={playerId}
            isOpponent={false}
            allCards={myCards}
            cardDefs={cardDefs}
            handCards={playerHandCards}
            opponentHandCount={0}
          />
        </div>

      </div>

      {/* ========== BOTTOM ACTION BAR ========== */}
      <ActionBar myTurn={myTurn} phase={phase} onPass={handlePass} />

      {/* Game Log */}
      <div style={styles.logPanel}>
        <GameLog messages={store.gameLog} />
      </div>

      {/* Card modal */}
      {store.showCardModal && store.modalCardId && (
        <CardModal
          cardId={store.modalCardId}
          cardDefs={cardDefs}
          onClose={() => store.setModalCard(null)}
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
    padding: '3px 16px',
    gap: '3px',
    minHeight: 0,
  },

  // All 5 rows use equal height — 20% each
  row: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  // Battlefield row — same equal height
  battlefieldRow: {
    flex: 1,
    display: 'flex',
    alignItems: 'stretch',
    minHeight: 0,
    overflow: 'hidden',
    padding: '4px 0',
  },

  // Log panel
  logPanel: {
    position: 'absolute',
    right: '8px',
    top: '70px',
    width: '260px',
    maxHeight: 'calc(100vh - 140px)',
    background: 'rgba(0,0,0,0.6)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.08)',
    overflowY: 'auto',
    fontSize: '12px',
    pointerEvents: 'none',
  },
};
