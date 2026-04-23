/**
 * CardArtView — renders a card with its artwork only (no tags/stats/labels).
 * Implements an enlarged hover view via ReactDOM.createPortal for readability.
 */

import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { CardInstance, CardDefinition } from '../../shared/types';

interface Props {
  card: CardInstance;
  cardDef: CardDefinition | undefined;
  isOpponent?: boolean;   // face-down if opponent-hidden
  showStats?: boolean;     // reserved for future use (stats not shown per issue #13)
  showKeywords?: boolean;  // reserved for future use (keywords not shown per issue #13)
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  onHover?: (instanceId: string | null) => void;
  maxHeight?: number;    // measured available height (pixels) — scales card to fit
  landscape?: boolean;   // render in landscape orientation (for battlefield cards)
}

// Card art aspect ratio (width / height) — portrait
const CARD_ASPECT = 744 / 1039;
// Battlefield card aspect ratio — landscape
const BF_ASPECT = 1039 / 744;

const sizeMap = {
  sm: { w: 64, h: 86 },
  md: { w: 100, h: 134 },
  lg: { w: 140, h: 188 },
};

const ENLARGE_W = 300;

function getEnlargeDims(smW: number, smH: number, landscape?: boolean): { w: number; h: number; left: number; top: number } {
  const aspect = landscape ? BF_ASPECT : CARD_ASPECT;
  const scale = ENLARGE_W / smW;
  const h = Math.round(smH * scale);
  const maxH = window.innerHeight - 32;
  const actualH = Math.min(h, maxH);
  const actualW = Math.round(actualH * aspect);
  return { w: actualW, h: actualH, left: 0, top: 0 };
}

export function CardArtView({
  card, cardDef, isOpponent = false,
  showStats = false, showKeywords = false,
  size = 'md', onClick, onHover, maxHeight, landscape = false
}: Props) {
  const [hovering, setHovering] = useState(false);
  const [enlargePos, setEnlargePos] = useState<{ w: number; h: number; left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Notify parent of hover state
  useEffect(() => {
    onHover?.(hovering ? card.instanceId : null);
  }, [hovering]);

  const hidden = isOpponent && card.owner_hidden;
  const def = cardDef;

  const baseDims = sizeMap[size];
  const dims = maxHeight
    ? { w: Math.round(baseDims.w * (maxHeight / baseDims.h)), h: maxHeight }
    : baseDims;

  const aspect = landscape ? BF_ASPECT : CARD_ASPECT;

  const imgStyle: React.CSSProperties = {
    width: dims.w,
    height: dims.h,
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: hidden
      ? 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)'
      : def?.imageUrl
        ? `url(${def.imageUrl}) center / ${landscape ? 'contain' : 'cover'} no-repeat`
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

  const handleMouseEnter = () => {
    setHovering(true);
    if (ref.current && def?.imageUrl) {
      const rect = ref.current.getBoundingClientRect();
      const { w, h } = getEnlargeDims(dims.w, dims.h, landscape);
      // Flip to left if not enough space on right
      const leftSpace = rect.left;
      const rightSpace = window.innerWidth - rect.right;
      let left: number;
      if (rightSpace >= w + 16) {
        left = rect.right + 16;
      } else if (leftSpace >= w + 16) {
        left = rect.left - w - 16;
      } else {
        // Center horizontally
        left = Math.max(16, (window.innerWidth - w) / 2);
      }
      // Vertical: try to align with card top, clamp to viewport
      let top = Math.max(16, Math.min(rect.top, window.innerHeight - h - 16));
      setEnlargePos({ w, h, left, top });
    }
  };

  const handleMouseLeave = () => {
    setHovering(false);
    setEnlargePos(null);
  };

  if (hidden) {
    return (
      <div
        ref={ref}
        style={imgStyle}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div style={cardBackOverlay}>
          <div style={cardBackRune}>❖</div>
        </div>
        <div style={statBadge}>
          <span style={mightText}>?</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={ref}
        style={imgStyle}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={def?.name ?? card.cardId}
      />
      {hovering && enlargePos && def?.imageUrl && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            left: enlargePos.left,
            top: enlargePos.top,
            width: enlargePos.w,
            height: enlargePos.h,
            borderRadius: '10px',
            border: '2px solid rgba(255,255,255,0.3)',
            background: `url(${def.imageUrl}) center / ${landscape ? 'contain' : 'cover'} no-repeat`,
            boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
            zIndex: 9999,
            pointerEvents: 'none',
            opacity: 1,
          }}
        />,
        document.body
      )}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────

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

const mightText: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 800,
  color: '#e63946',
};

const statBadge: React.CSSProperties = {
  position: 'absolute',
  top: '3px',
  right: '3px',
};
