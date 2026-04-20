/**
 * CardModal — detailed card view
 */
import React from 'react';
import type { CardDefinition } from '../../shared/types';

interface Props {
  cardId: string;
  cardDefs: Record<string, CardDefinition>;
  onClose: () => void;
}

export function CardModal({ cardId, cardDefs, onClose }: Props) {
  const def = cardDefs[cardId];

  if (!def) return null;

  const typeColor: Record<string, string> = {
    Unit: '#3b82f6', Spell: '#a855f7', Gear: '#f59e0b',
    Battlefield: '#10b981', Legend: '#ef4444', Rune: '#60a5fa',
  };
  const color = typeColor[def.type] ?? '#6b7280';

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={{ ...styles.header, borderBottom: `3px solid ${color}` }}>
          <div style={styles.name}>{def.name}</div>
          <div style={styles.typeRow}>
            <span style={{ ...styles.typeBadge, background: `${color}30`, color }}>
              {def.type}
            </span>
            {def.domains.map(d => (
              <span key={d} style={styles.domain}>{d}</span>
            ))}
          </div>
          {def.cost && (
            <div style={styles.cost}>
              ◆ {def.cost.rune}{def.cost.charges ? ` +${def.cost.charges}⚡` : ''}
            </div>
          )}
        </div>

        <div style={styles.body}>
          {def.keywords.length > 0 && (
            <div style={styles.keywords}>
              {def.keywords.map(kw => (
                <span key={kw} style={{ ...styles.kwBadge, borderColor: color, color }}>
                  {kw}
                </span>
              ))}
            </div>
          )}
          {def.stats && (
            <div style={styles.stats}>
              <span style={styles.stat}>⚔ Might: {def.stats.might ?? 0}</span>
              <span style={styles.stat}>♦ Health: {def.stats.health ?? 0}</span>
            </div>
          )}
          {def.abilities.length > 0 && (
            <div style={styles.abilities}>
              {def.abilities.map((ab, i) => (
                <div key={i} style={styles.ability}>
                  <span style={{ color, fontWeight: 600 }}>[{ab.trigger}]</span> {ab.effect}
                </div>
              ))}
            </div>
          )}
          {def.flavorText && (
            <div style={styles.flavor}>{def.flavorText}</div>
          )}
          <div style={styles.meta}>
            <span>{def.set}</span> · <span>{def.rarity}</span>
          </div>
        </div>
        <button style={styles.closeBtn} onClick={onClose}>×</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'linear-gradient(135deg, #1a1a2e, #141828)',
    borderRadius: '16px', padding: '24px',
    maxWidth: '440px', width: '90%',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    position: 'relative',
  },
  header: { marginBottom: '16px', paddingBottom: '12px' },
  name: { fontSize: '22px', fontWeight: 700, color: '#e8e8e8', marginBottom: '6px' },
  typeRow: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
  typeBadge: { padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' },
  domain: { fontSize: '11px', color: '#9ca3af', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px' },
  cost: { marginTop: '8px', fontSize: '16px', color: '#60a5fa', fontWeight: 700 },
  body: { display: 'flex', flexDirection: 'column', gap: '12px' },
  keywords: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  kwBadge: { padding: '3px 8px', border: '1px solid', borderRadius: '4px', fontSize: '11px', fontWeight: 600 },
  stats: { display: 'flex', gap: '16px' },
  stat: { fontSize: '14px', color: '#d1d5db' },
  abilities: { display: 'flex', flexDirection: 'column', gap: '6px' },
  ability: { fontSize: '13px', color: '#e8e8e8', lineHeight: 1.5 },
  flavor: { fontSize: '12px', color: '#6b7280', fontStyle: 'italic', borderLeft: '2px solid #374151', paddingLeft: '10px' },
  meta: { fontSize: '11px', color: '#4b5563' },
  closeBtn: {
    position: 'absolute', top: '12px', right: '12px',
    background: 'rgba(255,255,255,0.1)', border: 'none',
    color: '#9ca3af', fontSize: '20px', cursor: 'pointer', width: '28px', height: '28px',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
};
