/**
 * CardArtView — renders a card with its artwork, stats, and hover enlarge.
 * Used inside zone displays. Does NOT include click-to-play logic.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { CardInstance, CardDefinition } from '../../shared/types';

interface Props {
  card: CardInstance;
  cardDef: CardDefinition | undefined;
  isOpponent?: boolean;   // face-down if opponent-hidden
  showStats?: boolean;     // might/health
  showKeywords?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  onHover?: (instanceId: string | null) => void;
}

export function CardArtView({
  card, cardDef, isOpponent = false,
  showStats = true, showKeywords = false,
  size = 'md', onClick, onHover
}: Props) {
  const [hovering, setHovering] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Notify parent of hover state (for tooltip/preview systems)
  useEffect(() => {
    onHover?.(hovering ? card.instanceId : null);
  }, [hovering]);

  const hidden = isOpponent && card.owner_hidden;
  const def = cardDef;

  // Dimensions by size
  const dims = sizeMap[size];

  // Build background image style
  const imgStyle: React.CSSProperties = {
    width: dims.w,
    height: dims.h,
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: hidden
      ? 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)'
      : def?.imageUrl
        ? `url(${def.imageUrl}) center / cover no-repeat`
        : 'linear-gradient(135deg, #1e2a3a, #0a1a2a)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    cursor: onClick ? 'pointer' : 'default',
    position: 'relative',
    overflow: 'hidden',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    boxShadow: hovering
      ? '0 8px 24px rgba(0,0,0,0.5)'
      : '0 1px 4px rgba(0,0,0,0.3)',
    transform: hovering ? 'scale(1.06)' : 'scale(1)',
  };

  if (hidden) {
    return (
      <div
        ref={ref}
        style={imgStyle}
        onClick={onClick}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div style={cardBackOverlay}>
          <div style={cardBackRune}>❖</div>
        </div>
        {/* Count badge */}
        <div style={statBadge}>
          <span style={mightText}>?</span>
        </div>
      </div>
    );
  }

  // Foreground — card details overlay at bottom
  const bottomBar: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '3px 5px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  };

  return (
    <div
      ref={ref}
      style={imgStyle}
      onClick={onClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      title={def?.name ?? card.cardId}
    >
      {/* Name */}
      <div style={bottomBar}>
        <div style={cardNameStyle}>{def?.name ?? '?'}</div>

        {showStats && def?.stats && (
          <div style={statsRow}>
            {def.stats.might !== undefined && (
              <span style={mightText}>{def.stats.might}</span>
            )}
            {def.stats.health !== undefined && (
              <span style={healthText}>♦{def.stats.health}</span>
            )}
          </div>
        )}

        {showKeywords && def?.keywords && def.keywords.length > 0 && (
          <div style={keywordRow}>
            {def.keywords.slice(0, 2).map((kw: string) => (
              <span key={kw} style={keywordBadge}>{kw}</span>
            ))}
          </div>
        )}
      </div>

      {/* Cost */}
      {def?.cost && def.cost.rune > 0 && (
        <div style={costBadge}>
          {def.cost.rune}
        </div>
      )}

      {/* Type indicator */}
      {def && (
        <div style={{ ...typeBadge, ...typeBadgeColor(def.type) }}>
          {typeLabel(def)}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────

function typeLabel(def: CardDefinition): string {
  switch (def.type) {
    case 'Unit':    return def.superType === 'Champion' ? 'CHAMP' : 'UNIT';
    case 'Spell':   return def.superType === 'Signature' ? 'SIG' : 'SPELL';
    case 'Gear':    return def.superType === 'Signature' ? 'SIG' : 'GEAR';
    case 'Battlefield': return 'BF';
    case 'Legend':  return 'LGND';
    case 'Rune':     return 'RUNE';
    default:         return def.type.slice(0, 4).toUpperCase();
  }
}

function typeBadgeColor(type: string): React.CSSProperties {
  switch (type) {
    case 'Unit':         return { background: 'rgba(59,130,246,0.7)', color: '#fff' };
    case 'Spell':        return { background: 'rgba(16,185,129,0.7)', color: '#fff' };
    case 'Gear':         return { background: 'rgba(245,158,11,0.7)', color: '#fff' };
    case 'Battlefield':  return { background: 'rgba(124,58,237,0.7)', color: '#fff' };
    case 'Legend':       return { background: 'rgba(212,168,67,0.8)', color: '#000' };
    case 'Rune':         return { background: 'rgba(167,139,250,0.7)', color: '#fff' };
    default:             return { background: 'rgba(100,100,100,0.7)', color: '#fff' };
  }
}

const sizeMap = {
  sm: { w: 64, h: 86 },
  md: { w: 100, h: 134 },
  lg: { w: 140, h: 188 },
};

const cardBackOverlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)',
};

const cardBackRune: React.CSSProperties = {
  fontSize: '22px',
  color: 'rgba(255,255,255,0.18)',
};

const cardNameStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#e8e8e8',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  maxWidth: '100%',
};

const statsRow: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
};

const mightText: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 800,
  color: '#e63946',
};

const healthText: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 800,
  color: '#e8e8e8',
};

const keywordRow: React.CSSProperties = {
  display: 'flex',
  gap: '2px',
  flexWrap: 'wrap',
};

const keywordBadge: React.CSSProperties = {
  fontSize: '6px',
  padding: '0 2px',
  background: 'rgba(255,255,255,0.15)',
  borderRadius: '2px',
  color: '#aaa',
};

const statBadge: React.CSSProperties = {
  position: 'absolute',
  top: '3px',
  right: '3px',
};

const costBadge: React.CSSProperties = {
  position: 'absolute',
  top: '4px',
  left: '4px',
  background: 'rgba(0,0,0,0.7)',
  borderRadius: '50%',
  width: '20px',
  height: '20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '11px',
  fontWeight: 800,
  color: '#a78bfa',
};

const typeBadge: React.CSSProperties = {
  position: 'absolute',
  top: '3px',
  right: '3px',
  fontSize: '7px',
  fontWeight: 800,
  padding: '1px 3px',
  borderRadius: '3px',
  letterSpacing: '0.5px',
};
