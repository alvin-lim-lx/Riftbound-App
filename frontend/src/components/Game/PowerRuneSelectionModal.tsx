/**
 * PowerRuneSelectionModal - shown when playing a dual-domain card with
 * a power cost. Users select which domain rune(s) to recycle for each
 * power cost point, with multi-select when power cost > 1.
 */
import React, { useState } from 'react';
import type { Domain } from '../../shared/types';
import bodyRuneIcon from '../../assets/runes/Body Rune.png';
import calmRuneIcon from '../../assets/runes/Calm Rune.png';
import chaosRuneIcon from '../../assets/runes/Chaos Rune.png';
import furyRuneIcon from '../../assets/runes/Fury Rune.png';
import mindRuneIcon from '../../assets/runes/Mind Rune.png';
import orderRuneIcon from '../../assets/runes/Order Rune.png';

const DOMAIN_ICONS: Partial<Record<Domain, string>> = {
  Body: bodyRuneIcon,
  Calm: calmRuneIcon,
  Chaos: chaosRuneIcon,
  Fury: furyRuneIcon,
  Mind: mindRuneIcon,
  Order: orderRuneIcon,
};

const DOMAIN_COLORS: Record<string, string> = {
  Fury:    '#e63946',
  Calm:    '#60a5fa',
  Chaos:   '#f59e0b',
  Mind:    '#a78bfa',
  Body:    '#10b981',
  Order:   '#3b82f6',
};

interface Props {
  cardName: string;
  powerCost: number;
  domains: Domain[]; // exactly 2 domains
  onConfirm: (selectedDomains: Domain[]) => void;
  onCancel: () => void;
}

export function PowerRuneSelectionModal({
  cardName,
  powerCost,
  domains,
  onConfirm,
  onCancel,
}: Props) {
  const [selections, setSelections] = useState<Record<Domain, number>>(
    () => ({ [domains[0]]: 0, [domains[1]]: 0 } as Record<Domain, number>)
  );

  const totalSelected = selections[domains[0]] + selections[domains[1]];
  const isValid = totalSelected === powerCost;

  function toggle(domain: Domain, delta: 1 | -1) {
    const newVal = selections[domain] + delta;
    // Don't allow negative, and don't allow exceeding powerCost total
    if (newVal < 0) return;
    if (totalSelected + delta > powerCost) return;
    setSelections(prev => ({ ...prev, [domain]: newVal }));
  }

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleRow}>
            <h2 style={styles.title}>Choose Power Runes</h2>
          </div>
          <p style={styles.subtitle}>
            Select{' '}
            <span style={{ color: '#f59e0b', fontWeight: 900 }}>{powerCost}</span>{' '}
            rune{powerCost !== 1 ? 's' : ''} to recycle for{' '}
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>{cardName}</span>
          </p>
        </div>

        {/* Domain selection buttons */}
        <div style={styles.domainsRow}>
          {domains.map(domain => {
            const icon = DOMAIN_ICONS[domain];
            const color = DOMAIN_COLORS[domain] ?? '#9ca3af';
            const count = selections[domain];
            const canAdd = totalSelected < powerCost;
            const canRemove = count > 0;

            return (
              <div key={domain} style={styles.domainColumn}>
                {/* Domain icon */}
                <div style={{ ...styles.iconCircle, borderColor: color + '88' }}>
                  {icon ? (
                    <img
                      src={icon}
                      alt={domain}
                      style={{ width: '56px', height: '56px', borderRadius: '50%' }}
                    />
                  ) : (
                    <span style={{ color, fontSize: '32px', fontWeight: 900 }}>{domain[0]}</span>
                  )}
                </div>
                <span style={{ ...styles.domainName, color }}>{domain}</span>

                {/* Count badge */}
                <div style={{
                  ...styles.countBadge,
                  background: count > 0 ? color : 'rgba(255,255,255,0.06)',
                  borderColor: color + '66',
                  color: count > 0 ? '#fff' : '#555',
                }}>
                  {count}
                </div>

                {/* +/- controls */}
                <div style={styles.controls}>
                  <button
                    style={{
                      ...styles.controlBtn,
                      opacity: canRemove ? 1 : 0.3,
                      cursor: canRemove ? 'pointer' : 'not-allowed',
                    }}
                    onClick={() => toggle(domain, -1)}
                    disabled={!canRemove}
                    title="Remove one"
                  >
                    −
                  </button>
                  <button
                    style={{
                      ...styles.controlBtn,
                      opacity: canAdd ? 1 : 0.3,
                      cursor: canAdd ? 'pointer' : 'not-allowed',
                    }}
                    onClick={() => toggle(domain, 1)}
                    disabled={!canAdd}
                    title="Add one"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress indicator */}
        <div style={styles.progressRow}>
          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${(totalSelected / powerCost) * 100}%`,
                background: isValid ? '#22c55e' : '#f59e0b',
              }}
            />
          </div>
          <span style={{
            ...styles.progressLabel,
            color: isValid ? '#86efac' : totalSelected > 0 ? '#fbbf24' : '#64748b',
          }}>
            {totalSelected} / {powerCost}
          </span>
        </div>

        {/* Actions */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            style={{
              ...styles.confirmBtn,
              opacity: isValid ? 1 : 0.45,
              cursor: isValid ? 'pointer' : 'not-allowed',
            }}
            onClick={() => {
              if (!isValid) return;
              const result: Domain[] = [];
              for (const domain of domains) {
                for (let i = 0; i < selections[domain]; i++) result.push(domain);
              }
              // Match the order backend expects: fill first domain, then second
              onConfirm(result);
            }}
            disabled={!isValid}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
    borderRadius: '16px',
    padding: '28px 36px',
    width: 'min(420px, calc(100vw - 24px))',
    maxHeight: 'calc(100dvh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.62)',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  title: {
    color: '#f8fafc',
    fontSize: '22px',
    fontWeight: 900,
    margin: 0,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: '14px',
    margin: 0,
    lineHeight: 1.5,
  },
  domainsRow: {
    display: 'flex',
    gap: '24px',
    justifyContent: 'center',
  },
  domainColumn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },
  iconCircle: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  domainName: {
    fontSize: '12px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  countBadge: {
    fontSize: '16px',
    fontWeight: 900,
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  },
  controls: {
    display: 'flex',
    gap: '8px',
  },
  controlBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.08)',
    color: '#f8fafc',
    fontSize: '20px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.15s',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  progressBar: {
    flex: 1,
    height: '6px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.2s, background 0.2s',
  },
  progressLabel: {
    fontSize: '13px',
    fontWeight: 800,
    minWidth: '40px',
    textAlign: 'right',
    transition: 'color 0.2s',
  },
  footer: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    position: 'sticky',
    bottom: 0,
    background: '#111827',
    paddingTop: '10px',
  },
  cancelBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  confirmBtn: {
    padding: '10px 24px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 900,
    transition: 'opacity 0.15s',
    boxShadow: '0 8px 20px rgba(34,197,94,0.2)',
  },
};
