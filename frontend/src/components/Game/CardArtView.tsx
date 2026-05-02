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
  maxHeight?: number;      // if set, scales card down to fit this height
  landscape?: boolean;     // if true, enlarge uses landscape shape (for battlefield cards)
  onClick?: () => void;
  onHover?: (instanceId: string | null) => void;
  /** If true, the card is always shown in ready position (no exhaustion rotation). */
  forceReady?: boolean;
  /** CSS border string applied to the card image element. */
  border?: string;
}

// Card art aspect ratio (width / height)
const CARD_ASPECT = 744 / 1039;
// Battlefield card art aspect ratio (landscape)
const BF_ASPECT = 1039 / 744;

const portraitSizeMap = {
  xs: { w: 50, h: 70 },
  sm: { w: 64, h: 86 },
  md: { w: 100, h: 134 },
  lg: { w: 140, h: 188 },
};

const landscapeSizeMap = {
  sm: { w: 104, h: 74 },
  md: { w: 132, h: 94 },
  lg: { w: 168, h: 120 },
};

const ENLARGE_W = 220;
const ENLARGE_H = 220;
const HOVER_MARGIN = 16;
const RESERVED_BOTTOM_UI = 96;

function getEnlargeDims(smW: number, smH: number, isLandscape: boolean): { w: number; h: number; left: number; top: number } {
  if (isLandscape) {
    // Landscape: constrain by height, compute width maintaining landscape aspect
    const maxH = Math.max(140, window.innerHeight - RESERVED_BOTTOM_UI - HOVER_MARGIN);
    const h = Math.min(ENLARGE_H, maxH);
    const maxW = Math.max(220, window.innerWidth - HOVER_MARGIN * 2);
    const w = Math.min(Math.round(h * BF_ASPECT), maxW);
    return { w, h, left: 0, top: 0 };
  }
  const scale = ENLARGE_W / smW;
  const h = Math.round(smH * scale);
  const maxH = Math.max(190, window.innerHeight - RESERVED_BOTTOM_UI - HOVER_MARGIN);
  const actualH = Math.min(h, maxH);
  const actualW = Math.min(Math.round(actualH * CARD_ASPECT), Math.max(180, window.innerWidth - HOVER_MARGIN * 2));
  return { w: actualW, h: actualH, left: 0, top: 0 };
}

export function CardArtView({
  card, cardDef, isOpponent = false,
  showStats = false, showKeywords = false,
  size = 'md', maxHeight, landscape = false, onClick, onHover, forceReady = false,
  border,
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
  const isExhaustedUnitOrGear = !forceReady && card.exhausted && (def?.type === 'Unit' || def?.type === 'Gear');

  const base = landscape ? landscapeSizeMap[size] : portraitSizeMap[size];
  const aspect = landscape ? BF_ASPECT : CARD_ASPECT;
  const dims = maxHeight ? { w: Math.round(maxHeight * aspect), h: maxHeight } : base;
  const reservedDims = isExhaustedUnitOrGear ? { w: dims.h, h: dims.w } : dims;

  const wrapperStyle: React.CSSProperties = {
    width: reservedDims.w,
    height: reservedDims.h,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'visible',
    position: 'relative',
  };

  const imgStyle: React.CSSProperties = {
    width: dims.w,
    height: dims.h,
    borderRadius: '6px',
    border: border ?? '1px solid rgba(255,255,255,0.12)',
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
    transform: `${isExhaustedUnitOrGear ? 'rotate(90deg)' : 'rotate(0deg)'} ${hovering ? 'scale(1.06)' : 'scale(1)'}`,
    transformOrigin: 'center',
  };

  const handleMouseEnter = () => {
    setHovering(true);
    if (window.innerWidth < 900) return;
    if (ref.current && def?.imageUrl) {
      const rect = ref.current.getBoundingClientRect();
      const isLandscape = landscape;
      const { w, h } = getEnlargeDims(dims.w, dims.h, isLandscape);
      // Flip to left if not enough space on right
      const rightReserved = window.innerWidth >= 900 ? 320 : HOVER_MARGIN;
      const rightBoundary = window.innerWidth - rightReserved;
      const leftSpace = rect.left;
      const rightSpace = rightBoundary - rect.right;
      let left: number;
      if (rightSpace >= w + HOVER_MARGIN) {
        left = rect.right + HOVER_MARGIN;
      } else if (leftSpace >= w + HOVER_MARGIN) {
        left = rect.left - w - HOVER_MARGIN;
      } else {
        // Center horizontally
        left = Math.max(HOVER_MARGIN, (window.innerWidth - w) / 2);
      }
      left = Math.min(Math.max(HOVER_MARGIN, left), Math.max(HOVER_MARGIN, rightBoundary - w));
      // Vertical: try to align with card top, clamp above the action bar / mobile controls.
      const safeBottom = window.innerHeight - RESERVED_BOTTOM_UI;
      let top = Math.max(HOVER_MARGIN, Math.min(rect.top, safeBottom - h));
      setEnlargePos({ w, h, left, top });
    }
  };

  const handleMouseLeave = () => {
    setHovering(false);
    setEnlargePos(null);
  };

  if (hidden) {
    return (
      <div style={wrapperStyle}>
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
      </div>
    );
  }

  return (
    <>
      <div style={wrapperStyle}>
      <div
        ref={ref}
        style={imgStyle}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={def?.name ?? card.cardId}
      />
      </div>
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
            background: `url(${def.imageUrl}) center / contain no-repeat`,
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
