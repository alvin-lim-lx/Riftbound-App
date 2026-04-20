/**
 * DeckBuilderPage — build and manage decks
 *
 * Deck structure (per official Riftbound rules):
 *   - 1 Champion Legend (type=Legend)  → Legend Zone, never shuffled
 *   - 1 Chosen Champion (type=Champion) → Champion Zone, never shuffled
 *   - Main Deck 39 cards (Units/Spells/Gears) — Chosen Champion is separate
 *   - Rune Deck 12 Rune cards
 *   - Battlefields (Mode-dependent)
 *   - 8 sideboard cards
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { CARDS } from '@shared/cards';
import type { Deck, DeckValidation, CardDefinition } from '@shared/types';
import { useGameStore } from '../../store/gameStore';
import { authFetch } from '../../services/authService';
import { parseDeckImport, type ImportedDeck } from '../../utils/deckImport';

const API = '/api';

// ─── Helpers ───────────────────────────────────────────────

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupBy(arr: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const id of arr) map[id] = (map[id] ?? 0) + 1;
  return map;
}

// ─── Types ─────────────────────────────────────────────────

interface Props {
  playerId: string;
  onBack: () => void;
  onDeckSaved?: (deckId: string) => void;
}

// ─── Component ──────────────────────────────────────────────

export function DeckBuilderPage({ playerId, onBack, onDeckSaved }: Props) {
  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [deckName, setDeckName] = useState('');
  const [legendId, setLegendId] = useState('');
  const [chosenChampionCardId, setChosenChampionCardId] = useState('');
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [runeIds, setRuneIds] = useState<string[]>([]);
  const [battlefieldIds, setBattlefieldIds] = useState<string[]>([]);
  const [sideboardIds, setSideboardIds] = useState<string[]>([]);
  const [validation, setValidation] = useState<DeckValidation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'browse' | 'edit'>('browse');
  const setSelectedDeckId = useGameStore(s => s.setSelectedDeckId);
  const [searchQuery, setSearchQuery] = useState('');
  const [buildStep, setBuildStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [pickerTab, setPickerTab] = useState<'all' | 'units' | 'spells' | 'gears' | 'indeck'>('all');
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  // ── Normal card filter ─────────────────────────────────────
  // Exclude alternate-art / overnumbered / duplicate cards:
  // - Cards with "star" in their id (alternate art)
  // - Cards with letter suffixes after the card number (e.g. ogn-007a-298)
  // - The one known duplicate id: sfd-230-221 (appears twice)
  function isNormalCard(c: CardDefinition): boolean {
    if (c.id === 'sfd-230-221') return false;
    if (c.id.includes('star')) return false;
    // Letter suffix after card number before the set-size (e.g. ogn-007a-298)
    if (/^[a-z]+-[0-9]+[a-z]-[0-9]+$/.test(c.id)) return false;
    return true;
  }

  // ── Derived card lists from 950-card database ─────────────
  const legends = useMemo(() => Object.values(CARDS).filter(c => c.type === 'Legend' && isNormalCard(c)), []);
  // Champions are Unit cards with superType === 'Champion' (normal versions only)
  const champions = useMemo(() => Object.values(CARDS).filter(c => c.type === 'Unit' && c.superType === 'Champion' && isNormalCard(c)), []);

  // Chosen Champion options: must have the legend's championName tag AND be in the main deck
  const chosenChampionOptions = useMemo(() => {
    if (!legendId) return champions;
    const legend = CARDS[legendId];
    if (!legend || !legend.championName) return champions;
    return champions.filter(c =>
      c.tags?.includes(legend.championName!) && cardIds.includes(c.id)
    );
  }, [legendId, champions, cardIds]);

  // Domain(s) from the chosen legend (domains belong to the legend)
  const legendDomains = useMemo(() => {
    if (!legendId) return null;
    const legend = CARDS[legendId];
    return legend?.domains ?? null;
  }, [legendId]);

  // Domain-filtered main deck pools
  // Signature cards: only include if legend tag matches
  // legend.championName tells us which champion tag to match (e.g. 'Annie')
  const legendChampionName = useMemo(() => {
    if (!legendId) return null;
    return CARDS[legendId]?.championName ?? null;
  }, [legendId]);

  const domainFilteredUnits = useMemo(() => {
    if (!legendDomains) return [];
    return Object.values(CARDS).filter(c => {
      if (!isNormalCard(c)) return false;
      if (c.type !== 'Unit') return false;
      if (c.superType === 'Signature') {
        return legendChampionName != null && c.tags?.[0] === legendChampionName;
      }
      return c.domains?.some(d => legendDomains.includes(d));
    });
  }, [legendDomains, legendChampionName]);

  const domainFilteredSpells = useMemo(() => {
    if (!legendDomains) return [];
    return Object.values(CARDS).filter(c => {
      if (!isNormalCard(c)) return false;
      if (c.type !== 'Spell') return false;
      if (c.superType === 'Signature') {
        return legendChampionName != null && c.tags?.[0] === legendChampionName;
      }
      return c.domains?.some(d => legendDomains.includes(d));
    });
  }, [legendDomains, legendChampionName]);

  const domainFilteredGears = useMemo(() => {
    if (!legendDomains) return [];
    return Object.values(CARDS).filter(c => {
      if (!isNormalCard(c)) return false;
      if (c.type !== 'Gear') return false;
      if (c.superType === 'Signature') {
        return legendChampionName != null && c.tags?.[0] === legendChampionName;
      }
      return c.domains?.some(d => legendDomains.includes(d));
    });
  }, [legendDomains, legendChampionName]);

  // All rune types (normal only)
  const runes = useMemo(() => Object.values(CARDS).filter(c => c.type === 'Rune' && isNormalCard(c)), []);

  // Runes filtered by legend domain
  const domainFilteredRunes = useMemo(() => {
    if (!legendDomains) return [];
    return runes.filter(c => c.domains?.some(d => legendDomains.includes(d)));
  }, [legendDomains, runes]);

  // All domain-filtered cards combined (for "All" tab in step 3)
  const allDomainFiltered = useMemo(() => [
    ...domainFilteredUnits,
    ...domainFilteredSpells,
    ...domainFilteredGears,
  ], [domainFilteredUnits, domainFilteredSpells, domainFilteredGears]);
  const battlefields = useMemo(() => Object.values(CARDS).filter(c => c.type === 'Battlefield' && isNormalCard(c)), []);

  // ── Search + cost filter helper ─────────────────────────────
  function filterBySearch(cards: CardDefinition[], query: string): CardDefinition[] {
    if (!query.trim()) return cards;
    const q = query.toLowerCase();
    return cards.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.tags?.some(t => t.toLowerCase().includes(q)) ||
      c.domains?.some(d => d.toLowerCase().includes(q)) ||
      c.keywords?.some(k => k.toLowerCase().includes(q))
    );
  }

  function filterCards(cards: CardDefinition[], query: string, cost: number | null): CardDefinition[] {
    let result = filterBySearch(cards, query);
    if (cost !== null) {
      result = result.filter(c => (c.cost?.rune ?? 0) === cost);
    }
    return result;
  }

  // Pre-select champion when legend changes; clear stale champion if no longer valid
  useEffect(() => {
    if (!legendId) return;
    // If the current champion is not in the new options list, clear it
    if (chosenChampionCardId && !chosenChampionOptions.find(c => c.id === chosenChampionCardId)) {
      setChosenChampionCardId('');
    }
    // Auto-select first valid champion if none selected
    if (!chosenChampionCardId && chosenChampionOptions.length > 0) {
      setChosenChampionCardId(chosenChampionOptions[0].id);
    }
  }, [legendId, chosenChampionOptions]);

  // ── Fetch decks ─────────────────────────────────────────
  useEffect(() => { fetchDecks(); }, []);

  function fetchDecks() {
    authFetch(`${API}/decks`)
      .then(r => r.json())
      .then(data => setMyDecks(data.decks ?? []))
      .catch(() => {});
  }

  function selectDeck(deck: Deck) {
    setSelectedDeck(deck);
    setDeckName(deck.name ?? '');
    setLegendId(deck.legendId);
    setChosenChampionCardId(deck.chosenChampionCardId ?? '');
    setCardIds([...deck.cardIds]);
    setRuneIds([...(deck.runeIds ?? [])]);
    setBattlefieldIds(deck.battlefieldIds?.length >= 3 ? [...deck.battlefieldIds] : [battlefields[0]?.id ?? '']);
    setSideboardIds([...(deck.sideboardIds ?? [])]);
    setValidation(null);
    setTab('edit');
    setBuildStep(1);
    setSearchQuery('');
  }

  function newDeck() {
    setSelectedDeck(null);
    setDeckName('');
    setLegendId(legends[0]?.id ?? '');
    setChosenChampionCardId('');
    setCardIds([]);
    setRuneIds([]);
    setBattlefieldIds([battlefields[0]?.id ?? '', battlefields[1]?.id ?? '', battlefields[2]?.id ?? '']);
    setSideboardIds([]);
    setValidation(null);
    setTab('edit');
    setBuildStep(1);
    setPickerTab('all');
    setSearchQuery('');
  }

  function copyCount(arr: string[], cardId: string) {
    return arr.filter(id => id === cardId).length;
  }

  function toggleCard(arr: string[], setArr: React.Dispatch<React.SetStateAction<string[]>>, cardId: string, maxCopies = 3) {
    setArr(prev => {
      const has = prev.includes(cardId);
      const count = prev.filter(id => id === cardId).length;
      if (has && count >= maxCopies) {
        return prev.filter(id => id !== cardId); // remove last copy
      }
      return [...prev, cardId]; // add copy (up to max)
    });
  }

  function removeCard(arr: string[], setArr: React.Dispatch<React.SetStateAction<string[]>>, cardId: string) {
    setArr(prev => {
      const idx = prev.indexOf(cardId);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }

  // ── API calls ──────────────────────────────────────────
  async function validateDeck() {
    setError('');
    try {
      const res = await fetch(`${API}/decks/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: deckName,
          legendId,
          chosenChampionCardId,
          cardIds,
          runeIds,
          battlefieldIds,
          sideboardIds,
        }),
      });
      const data = await res.json();
      setValidation(data.validation ?? null);
    } catch {
      // Network/server errors — silently ignore; validation state is cleared already
    }
  }

  async function saveDeck() {
    setSaving(true);
    setError('');
    try {
      const deckNameVal = deckName.trim() || 'Untitled Deck';

      if (selectedDeck) {
        // Existing deck — always use draft save (no validation required)
        const res = await authFetch(`${API}/decks/${selectedDeck.id}/draft`, {
          method: 'PUT',
          body: JSON.stringify({
            name: deckNameVal,
            legendId,
            chosenChampionCardId: chosenChampionCardId || null,
            cardIds,
            runeIds,
            battlefieldIds,
            sideboardIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Failed to save draft');
          return;
        }
        fetchDecks();
        setSelectedDeck(data.deck);
        setSelectedDeckId(data.deck.id);
        if (onDeckSaved) onDeckSaved(data.deck.id);
      } else {
        // New deck — require name + legend at minimum to POST a full deck
        if (!deckName.trim()) {
          setError('Please enter a deck name before saving');
          return;
        }
        if (!legendId) {
          setError('Please choose a legend before saving');
          return;
        }
        const res = await authFetch(`${API}/decks`, {
          method: 'POST',
          body: JSON.stringify({
            name: deckNameVal,
            legendId,
            chosenChampionCardId: chosenChampionCardId || null,
            cardIds,
            runeIds,
            battlefieldIds,
            sideboardIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Failed to save deck');
          return;
        }
        fetchDecks();
        setSelectedDeck(data.deck);
        setSelectedDeckId(data.deck.id);
        if (onDeckSaved) onDeckSaved(data.deck.id);
      }
    } catch {
      setError('Failed to save deck. Is server running?');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDeck(id: string) {
    if (!confirm('Delete this deck?')) return;
    await authFetch(`${API}/decks/${id}`, { method: 'DELETE' });
    if (selectedDeck?.id === id) newDeck();
    fetchDecks();
  }

  function applyImport() {
    setImportError('');
    const trimmed = importText.trim();
    if (!trimmed) {
      setImportError('Please paste a deck code or deck text.');
      return;
    }
    let imported: ImportedDeck;
    try {
      imported = parseDeckImport(trimmed);
    } catch (e) {
      setImportError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (imported.errors.length > 0 && imported.cardIds.length === 0 && !imported.legendName && imported.runeIds.length === 0) {
      setImportError(imported.errors.slice(0, 3).join('\n'));
      return;
    }

    // Find legend card
    let foundLegendId = '';
    if (imported.legendName) {
      // Try exact then strip prefix
      const stripPrefix = (n: string) => n.includes(',') ? n.split(',')[1].trim() : n;
      foundLegendId = Object.keys(CARDS).find(k => {
        const c = CARDS[k];
        return c.type === 'Legend' && (c.name === imported.legendName || c.name === stripPrefix(imported.legendName));
      }) ?? '';
    }

    // Find chosen champion card
    let foundChampionId = '';
    if (imported.chosenChampionName) {
      const stripPrefix = (n: string) => n.includes(',') ? n.split(',')[1].trim() : n;
      foundChampionId = Object.keys(CARDS).find(k => {
        const c = CARDS[k];
        return c.type === 'Unit' && c.superType === 'Champion' &&
          (c.name === imported.chosenChampionName || c.name === stripPrefix(imported.chosenChampionName));
      }) ?? '';
    }

    setSelectedDeck(null);
    setDeckName(foundLegendId ? `Import: ${CARDS[foundLegendId]?.name ?? imported.legendName}` : 'Imported Deck');
    setLegendId(foundLegendId);
    setChosenChampionCardId(foundChampionId);
    // Add the chosen champion to the main deck (per Section 101, Chosen Champion is part of the 39-40 card main deck)
    const importedCardIds = [...imported.cardIds];
    if (foundChampionId) {
      importedCardIds.unshift(foundChampionId);
    }
    setCardIds(importedCardIds);
    setRuneIds([...imported.runeIds]);
    setBattlefieldIds(imported.battlefieldIds.length >= 3 ? [...imported.battlefieldIds] : []);
    setSideboardIds([...imported.sideboardIds]);
    setValidation(null);
    setTab('edit');
    setBuildStep(1);
    setPickerTab('all');
    setSearchQuery('');
    setShowImport(false);
  }

  // ── Derived counts ─────────────────────────────────────
  const mainDeckCount = cardIds.length;
  const runeCount = runeIds.length;
  const sideboardCount = sideboardIds.length;

  // ── Render ─────────────────────────────────────────────
  return (
    <div style={styles.root}>
      <div id="card-hover-portal" />
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back to Lobby</button>
        <h2 style={styles.title}>⚔️ Deck Builder</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={styles.importBtn} onClick={() => { setShowImport(true); setImportText(''); setImportError(''); }}>📥 Import</button>
          <button style={styles.newBtn} onClick={newDeck}>+ New Deck</button>
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div style={styles.importOverlay} onClick={() => setShowImport(false)}>
          <div style={styles.importModal} onClick={e => e.stopPropagation()}>
            <div style={styles.importModalHeader}>
              <h3 style={styles.importModalTitle}>📥 Import Deck</h3>
              <button style={styles.importModalClose} onClick={() => setShowImport(false)}>✕</button>
            </div>
            <p style={styles.importModalHint}>
              Paste a deck list in <strong>text format</strong> (Legend / Champion / MainDeck sections).
            </p>
            <textarea
              style={styles.importTextarea}
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportError(''); }}
              placeholder={'Legend:\n1 LeBlanc, Deceiver\nChampion:\n1 LeBlanc, Everywhere at Once\nMainDeck:\n3 Watchful Sentry\n...'}
              rows={10}
            />
            {importError && <div style={styles.importError}>{importError}</div>}
            <div style={styles.importModalActions}>
              <button style={styles.importCancel} onClick={() => setShowImport(false)}>Cancel</button>
              <button style={styles.importConfirm} onClick={applyImport}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={styles.tabs}>
        <button style={{ ...styles.tab, ...(tab === 'browse' ? styles.tabActive : {}) }} onClick={() => setTab('browse')}>
          My Decks ({myDecks.length})
        </button>
        <button style={{ ...styles.tab, ...(tab === 'edit' ? styles.tabActive : {}) }} onClick={() => setTab('edit')}>
          {selectedDeck ? 'Edit Deck' : 'Create Deck'}
        </button>
      </div>

      {/* Browse decks */}
      {tab === 'browse' && (
        <div style={styles.deckList}>
          {myDecks.length === 0 && <p style={styles.emptyMsg}>No decks yet. Create one!</p>}
          {myDecks.map(deck => (
            <div key={deck.id} style={styles.deckCard} onClick={() => selectDeck(deck)}>
              <div style={styles.deckCardName}>{deck.name}</div>
              <div style={styles.deckCardMeta}>
                {CARDS[deck.legendId]?.name ?? deck.legendId} · {deck.cardIds.length} main · {deck.runeIds?.length ?? 0} runes
              </div>
              <button style={styles.deleteBtn} onClick={e => { e.stopPropagation(); deleteDeck(deck.id); }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Edit deck */}
      {tab === 'edit' && (
        <div style={styles.editorWithNav}>

          {/* ── Fixed Step Navigation ────────────────────────────── */}
          <div style={styles.navPane}>
            <div style={styles.navTitle}>Deck Steps</div>
            {[
              { n: 1, label: 'Choose Legend' },
              { n: 2, label: 'Choose Battlefields' },
              { n: 3, label: 'Build Main Deck' },
              { n: 4, label: 'Choose Champion' },
              { n: 5, label: 'Build Rune Deck' },
              { n: 6, label: 'Build Sideboard' },
            ].map(({ n, label }) => (
              <button
                key={n}
                style={{
                  ...styles.navItem,
                  ...(buildStep === n ? styles.navItemActive : {}),
                  ...(buildStep > n ? styles.navItemDone : {}),
                }}
                onClick={() => setBuildStep(n as 1 | 2 | 3 | 4 | 5 | 6)}
              >
                <span style={styles.navNum}>{buildStep > n ? '✓' : n}</span>
                <span style={styles.navLabel}>{label}</span>
                {n === 1 && legendId && <span style={styles.navCheck}>✓</span>}
                {n === 2 && battlefieldIds.length === 3 && <span style={styles.navCheck}>✓</span>}
                {n === 3 && mainDeckCount === 40 && <span style={styles.navCheck}>✓</span>}
                {n === 4 && chosenChampionCardId && CARDS[chosenChampionCardId]?.tags?.includes(legendChampionName!) && <span style={styles.navCheck}>✓</span>}
                {n === 5 && runeCount === 12 && <span style={styles.navCheck}>✓</span>}
                {n === 6 && sideboardCount === 8 && <span style={styles.navCheck}>✓</span>}
              </button>
            ))}

            <div style={styles.navActions}>
              <button
                style={styles.navBack}
                onClick={() => setBuildStep(Math.max(1, buildStep - 1) as 1|2|3|4|5|6)}
                disabled={buildStep === 1}
              >
                ← Back
              </button>
              <button
                style={styles.navNext}
                onClick={() => setBuildStep(Math.min(6, buildStep + 1) as 1|2|3|4|5|6)}
                disabled={buildStep === 6}
              >
                Next →
              </button>
            </div>
          </div>

          {/* ── Step Content ─────────────────────────────────────── */}
          <div style={styles.stepContent}>

            {/* Step 1: Legend */}
            {buildStep === 1 && (
              <div style={styles.stepPane}>
                <div style={styles.stepHeader}>
                  <h3 style={styles.stepTitle}>Step 1: Choose your Legend</h3>
                  <p style={styles.stepSubtitle}>Pick a Legend card for the Legend Zone.</p>
                </div>
                <div style={styles.legendGrid}>
                  {legends.map(c => (
                    <StepCard
                      key={c.id}
                      card={c}
                      cardType="Legend"
                      selected={legendId === c.id}
                      count={legendId === c.id ? 1 : 0}
                      onClick={() => setLegendId(legendId === c.id ? '' : c.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Battlefields */}
            {buildStep === 2 && (
              <div style={styles.stepPane}>
                <div style={styles.stepHeader}>
                  <h3 style={styles.stepTitle}>Step 2: Choose your Battlefields</h3>
                  <p style={styles.stepSubtitle}>Pick exactly <strong>3 battlefields</strong> — one starting + two in the sideboard.</p>
                </div>
                <div style={styles.bfSelectCount}>
                  Selected: <strong>{battlefieldIds.length}/3</strong>
                </div>
                <div style={styles.cardGrid}>
                  {battlefields.map(c => (
                    <CardButton
                      key={c.id}
                      card={c}
                      count={battlefieldIds.filter(id => id === c.id).length}
                      maxCount={99}
                      selected={battlefieldIds.includes(c.id)}
                      onClick={() => {
                        if (battlefieldIds.includes(c.id)) {
                          setBattlefieldIds(battlefieldIds.filter(id => id !== c.id));
                        } else if (battlefieldIds.length < 3) {
                          setBattlefieldIds([...battlefieldIds, c.id]);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Main deck */}
            {buildStep === 3 && (
              <div style={styles.stepPane}>
                <div style={styles.stepHeader}>
                  <h3 style={styles.stepTitle}>Step 3: Build your Main Deck</h3>
                  <p style={styles.stepSubtitle}>Pick exactly <strong>40 cards</strong> for your main deck.</p>
                </div>

                {/* Search bar */}
                <div style={styles.searchBarWrap}>
                  <input
                    style={styles.searchBar}
                    placeholder="Search cards by name, tag, domain, or keyword…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button style={styles.searchClear} onClick={() => setSearchQuery('')}>✕</button>
                  )}
                </div>

                {/* Picker tabs */}
                <div style={styles.pickerTabs}>
                  {(['all', 'units', 'spells', 'gears', 'indeck'] as const).map(t => (
                    <button
                      key={t}
                      style={{ ...styles.pickerTab, ...(pickerTab === t ? styles.pickerTabActive : {}) }}
                      onClick={() => setPickerTab(t)}
                    >
                      {pickerLabel(t)}
                    </button>
                  ))}
                </div>

                {/* Cost filter */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button
                    style={{ ...styles.costFilterBtn, ...(costFilter === null ? styles.costFilterBtnActive : {}) }}
                    onClick={() => setCostFilter(null)}
                  >
                    All Costs
                  </button>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(c => (
                    <button
                      key={c}
                      style={{ ...styles.costFilterBtn, ...(costFilter === c ? styles.costFilterBtnActive : {}) }}
                      onClick={() => setCostFilter(costFilter === c ? null : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div style={styles.deckCount}>
                  Main Deck: <strong>{mainDeckCount}/40</strong>
                  {legendDomains && <span style={{ color: '#6b7280', marginLeft: 12 }}>Domain: {legendDomains.join(' / ')}</span>}
                </div>

                {pickerTab === 'all' && (
                  <div style={styles.cardGrid}>
                    {filterCards(allDomainFiltered, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(cardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(cardIds, setCardIds, c.id, 3)}
                        onRightClick={() => removeCard(cardIds, setCardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'units' && (
                  <div style={styles.cardGrid}>
                    {filterCards(domainFilteredUnits, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(cardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(cardIds, setCardIds, c.id, 3)}
                        onRightClick={() => removeCard(cardIds, setCardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'spells' && (
                  <div style={styles.cardGrid}>
                    {filterCards(domainFilteredSpells, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(cardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(cardIds, setCardIds, c.id, 3)}
                        onRightClick={() => removeCard(cardIds, setCardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'gears' && (
                  <div style={styles.cardGrid}>
                    {filterCards(domainFilteredGears, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(cardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(cardIds, setCardIds, c.id, 3)}
                        onRightClick={() => removeCard(cardIds, setCardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'indeck' && (() => {
                  const grouped = groupBy(cardIds);
                  const uniqueCards = Object.keys(grouped)
                    .map(id => CARDS[id])
                    .filter(Boolean)
                    .filter(c => filterCards([c], searchQuery, costFilter).length > 0);
                  return (
                    <div style={styles.cardGrid}>
                      {uniqueCards.length === 0 && (
                        <p style={{ color: '#6b7280', padding: 16 }}>No cards in deck yet.</p>
                      )}
                      {uniqueCards.map(c => (
                        <CardButton
                          key={c.id}
                          card={c}
                          count={grouped[c.id]}
                          maxCount={3}
                          onClick={() => removeCard(cardIds, setCardIds, c.id)}
                          onRightClick={() => removeCard(cardIds, setCardIds, c.id)}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Step 4: Champion — pick from main deck units */}
            {buildStep === 4 && (
              <div style={styles.stepPane}>
                <div style={styles.stepHeader}>
                  <h3 style={styles.stepTitle}>Step 4: Choose your Champion</h3>
                  <p style={styles.stepSubtitle}>
                    Pick the Champion unit from your main deck — a unit with the{' '}
                    <strong>{CARDS[legendId]?.championName ?? 'champion'}</strong> tag.
                  </p>
                </div>
                <div style={styles.championGrid}>
                  {chosenChampionOptions
                    .map(c => (
                      <StepCard
                        key={c.id}
                        card={c}
                        cardType="Champion"
                        selected={chosenChampionCardId === c.id}
                        count={chosenChampionCardId === c.id ? 1 : 0}
                        onClick={() => setChosenChampionCardId(chosenChampionCardId === c.id ? '' : c.id)}
                      />
                    ))}
                </div>
                {chosenChampionOptions.length === 0 && (
                  <p style={styles.emptyMsg}>
                    No champion units found for this legend's tag. This may be a data issue.
                  </p>
                )}
              </div>
            )}

            {/* Step 5: Rune deck */}
            {buildStep === 5 && (
              <div style={styles.stepPane}>
                <div style={styles.stepHeader}>
                  <h3 style={styles.stepTitle}>Step 5: Build your Rune Deck</h3>
                  <p style={styles.stepSubtitle}>Pick exactly <strong>12 runes</strong>.</p>
                </div>
                <div style={styles.searchBarWrap}>
                  <input
                    style={styles.searchBar}
                    placeholder="Search runes by name…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button style={styles.searchClear} onClick={() => setSearchQuery('')}>✕</button>
                  )}
                </div>
                <div style={styles.deckCount}>
                  Rune Deck: <strong>{runeCount}/12</strong>
                  {legendDomains && <span style={{ color: '#6b7280', marginLeft: 12 }}>Domain: {legendDomains.join(' / ')}</span>}
                </div>
                <div style={styles.cardGrid}>
                  {filterBySearch(domainFilteredRunes, searchQuery).map(c => (
                    <CardButton
                      key={c.id}
                      card={c}
                      count={copyCount(runeIds, c.id)}
                      maxCount={12}
                      onClick={() => toggleCard(runeIds, setRuneIds, c.id, 12)}
                      onRightClick={() => removeCard(runeIds, setRuneIds, c.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Step 6: Sideboard */}
            {buildStep === 6 && (
              <div style={styles.stepPane}>
                <div style={styles.stepHeader}>
                  <h3 style={styles.stepTitle}>Step 6: Build your Sideboard</h3>
                  <p style={styles.stepSubtitle}>Pick exactly <strong>8 cards</strong>.</p>
                </div>

                {/* Search bar */}
                <div style={styles.searchBarWrap}>
                  <input
                    style={styles.searchBar}
                    placeholder="Search cards by name, tag, domain, or keyword…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button style={styles.searchClear} onClick={() => setSearchQuery('')}>✕</button>
                  )}
                </div>

                {/* Picker tabs */}
                <div style={styles.pickerTabs}>
                  {(['all', 'units', 'spells', 'gears', 'indeck'] as const).map(t => (
                    <button
                      key={t}
                      style={{ ...styles.pickerTab, ...(pickerTab === t ? styles.pickerTabActive : {}) }}
                      onClick={() => setPickerTab(t)}
                    >
                      {pickerLabel(t)}
                    </button>
                  ))}
                </div>

                {/* Cost filter */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button
                    style={{ ...styles.costFilterBtn, ...(costFilter === null ? styles.costFilterBtnActive : {}) }}
                    onClick={() => setCostFilter(null)}
                  >
                    All Costs
                  </button>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(c => (
                    <button
                      key={c}
                      style={{ ...styles.costFilterBtn, ...(costFilter === c ? styles.costFilterBtnActive : {}) }}
                      onClick={() => setCostFilter(costFilter === c ? null : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div style={styles.deckCount}>
                  Sideboard: <strong>{sideboardCount}/8</strong>
                  {legendDomains && <span style={{ color: '#6b7280', marginLeft: 12 }}>Domain: {legendDomains.join(' / ')}</span>}
                </div>

                {pickerTab === 'all' && (
                  <div style={styles.cardGrid}>
                    {filterCards([...domainFilteredUnits, ...domainFilteredSpells, ...domainFilteredGears], searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(sideboardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(sideboardIds, setSideboardIds, c.id, 3)}
                        onRightClick={() => removeCard(sideboardIds, setSideboardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'units' && (
                  <div style={styles.cardGrid}>
                    {filterCards(domainFilteredUnits, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(sideboardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(sideboardIds, setSideboardIds, c.id, 3)}
                        onRightClick={() => removeCard(sideboardIds, setSideboardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'spells' && (
                  <div style={styles.cardGrid}>
                    {filterCards(domainFilteredSpells, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(sideboardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(sideboardIds, setSideboardIds, c.id, 3)}
                        onRightClick={() => removeCard(sideboardIds, setSideboardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'gears' && (
                  <div style={styles.cardGrid}>
                    {filterCards(domainFilteredGears, searchQuery, costFilter).map(c => (
                      <CardButton
                        key={c.id}
                        card={c}
                        count={copyCount(sideboardIds, c.id)}
                        maxCount={3}
                        onClick={() => toggleCard(sideboardIds, setSideboardIds, c.id, 3)}
                        onRightClick={() => removeCard(sideboardIds, setSideboardIds, c.id)}
                      />
                    ))}
                  </div>
                )}
                {pickerTab === 'indeck' && (() => {
                  const grouped = groupBy(sideboardIds);
                  const uniqueCards = Object.keys(grouped)
                    .map(id => CARDS[id])
                    .filter(Boolean)
                    .filter(c => filterCards([c], searchQuery, costFilter).length > 0);
                  return (
                    <div style={styles.cardGrid}>
                      {uniqueCards.length === 0 && (
                        <p style={{ color: '#6b7280', padding: 16 }}>No cards in sideboard yet.</p>
                      )}
                      {uniqueCards.map(c => (
                        <CardButton
                          key={c.id}
                          card={c}
                          count={grouped[c.id]}
                          maxCount={3}
                          onClick={() => removeCard(sideboardIds, setSideboardIds, c.id)}
                          onRightClick={() => removeCard(sideboardIds, setSideboardIds, c.id)}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ── Right: deck config panel ──────────────────────── */}
          <div style={styles.configPanel}>
            <h3 style={styles.configTitle}>{selectedDeck ? 'Edit Deck' : 'New Deck'}</h3>

            <label style={styles.label}>Deck Name</label>
            <input style={styles.input} value={deckName} onChange={e => setDeckName(e.target.value)} placeholder="My Awesome Deck" />

            {/* Legend summary */}
            {legendId && (
              <div style={styles.configLegend}>
                <img src={CARDS[legendId]?.imageUrl} alt="" width={48} height={64} style={{ borderRadius: '6px' }} />
                <div>
                  <div style={styles.configLegendLabel}>Legend</div>
                  <div style={styles.configLegendName}>{CARDS[legendId]?.championName ?? ''} {CARDS[legendId]?.name}</div>
                </div>
              </div>
            )}

            {/* Chosen Champion summary */}
            {chosenChampionCardId && CARDS[chosenChampionCardId] && (
              <div style={styles.configLegend}>
                <img src={CARDS[chosenChampionCardId]?.imageUrl} alt="" width={48} height={64} style={{ borderRadius: '6px' }} />
                <div>
                  <div style={styles.configLegendLabel}>Champion</div>
                  <div style={styles.configLegendName}>{CARDS[chosenChampionCardId]?.name}</div>
                </div>
              </div>
            )}

            {/* Deck infographics */}
            {cardIds.length > 0 && (() => {
              // ── Type breakdown ──────────────────────────────────
              const typeCount = { Unit: 0, Spell: 0, Gear: 0 };
              const runeCostCount: Record<number, number> = {};
              const powerCostCount: Record<string, number> = {};
              let maxRuneCost = 0;
              for (const cardId of cardIds) {
                const card = CARDS[cardId];
                if (!card) continue;
                if (card.type === 'Unit' || card.type === 'Spell' || card.type === 'Gear') typeCount[card.type]++;
                const runeCost = card.cost?.rune ?? 0;
                if (runeCost > maxRuneCost) maxRuneCost = runeCost;
                runeCostCount[runeCost] = (runeCostCount[runeCost] ?? 0) + 1;
                const powerCost = card.cost?.power ?? 0;
                if (powerCost > 0) {
                  const primaryDomain = card.domains?.[0] ?? 'Neutral';
                  powerCostCount[primaryDomain] = (powerCostCount[primaryDomain] ?? 0) + powerCost;
                }
              }
              const domainColors: Record<string, string> = {
                Fury: '#ef4444',   // red
                Chaos: '#a855f7',  // purple
                Mind: '#3b82f6',   // blue
                Body: '#f97316',   // orange
                Calm: '#22c55e',   // green
                Order: '#eab308',  // yellow
                Neutral: '#9ca3af', Colorless: '#6b7280',
              };
              const maxPower = Math.max(...Object.values(powerCostCount), 1);
              const maxRuneBar = Math.max(...Object.values(runeCostCount), 1);
              const chartH = 64; // px tall for column charts
              const barW = '100%';
              return (
                <>
                  {/* Type breakdown */}
                  <div style={styles.infoSection}>
                    <div style={styles.infoTitle}>DECK BREAKDOWN</div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      {(['Unit', 'Spell', 'Gear'] as const).map(t => (
                        <div key={t} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#fbbf24' }}>{typeCount[t]}</div>
                          <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' }}>{t}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rune cost distribution — column chart */}
                  <div style={styles.infoSection}>
                    <div style={styles.infoTitle}>ENERGY COST</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: `${chartH + 20}px` }}>
                      {/* Y-axis ticks */}
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: `${chartH}px`, fontSize: '9px', color: '#6b7280', textAlign: 'right', paddingRight: '4px' }}>
                        <span>{maxRuneBar}</span>
                        <span>{Math.round(maxRuneBar / 2)}</span>
                        <span>0</span>
                      </div>
                      {Array.from({ length: maxRuneCost + 1 }, (_, cost) => {
                        const count = runeCostCount[cost] ?? 0;
                        const pct = count / maxRuneBar;
                        return (
                          <div key={cost} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: '2px' }}>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>{count}</div>
                            <div style={{ width: barW, height: `${Math.max(2, pct * chartH)}px`, background: '#6366f1', borderRadius: '3px', minHeight: '2px' }} />
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>{cost}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Power cost distribution — vertical column chart by domain */}
                  <div style={styles.infoSection}>
                    <div style={styles.infoTitle}>POWER COST</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: `${chartH + 20}px` }}>
                      {/* Y-axis ticks */}
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: `${chartH}px`, fontSize: '9px', color: '#6b7280', textAlign: 'right', paddingRight: '4px' }}>
                        <span>{maxPower}</span>
                        <span>{Math.round(maxPower / 2)}</span>
                        <span>0</span>
                      </div>
                      {Object.entries(powerCostCount)
                        .sort((a, b) => b[1] - a[1])
                        .map(([domain, total]) => {
                          const color = domainColors[domain] ?? '#9ca3af';
                          const pct = total / maxPower;
                          return (
                            <div key={domain} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: '2px' }}>
                              <div style={{ fontSize: '9px', color: '#6b7280' }}>{total}</div>
                              <div style={{ width: barW, height: `${Math.max(2, pct * chartH)}px`, background: color, borderRadius: '3px', minHeight: '2px' }} />
                              <div style={{ fontSize: '8px', color: '#9ca3af', textAlign: 'center', lineHeight: 1 }}>{domain}</div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Deck stats */}
            <div style={styles.statsRow}>
              <span>Main <strong>{mainDeckCount}/40</strong></span>
              <span>Runes <strong>{runeCount}/12</strong></span>
              <span>Side <strong>{sideboardCount}/8</strong></span>
            </div>

            {validation && (
              <div style={styles.validationBox}>
                {!validation.isValid && (
                  <div style={styles.validationErrors}>
                    {validation.errors.map((e, i) => <div key={i} style={styles.validationError}>✗ {e}</div>)}
                  </div>
                )}
                {validation.warnings.map((w, i) => <div key={i} style={styles.validationWarn}>⚠ {w}</div>)}
                {validation.isValid && <div style={styles.validationOk}>✓ Deck looks valid!</div>}
              </div>
            )}

            {error && <p style={styles.errorMsg}>{error}</p>}

            <div style={styles.actions}>
              <button style={styles.validateBtn} onClick={validateDeck}>Validate</button>
              <button style={styles.saveBtn} onClick={saveDeck} disabled={saving}>{saving ? 'Saving...' : 'Save Deck'}</button>
            </div>

            {/* Main deck summary */}
            {cardIds.length > 0 && (
              <div style={styles.deckSummary}>
                <h4 style={styles.summaryTitle}>Main Deck ({mainDeckCount})</h4>
                <div style={styles.summaryGrid}>
                  {Object.entries(groupBy(cardIds)).map(([cardId, count]) => (
                    <div key={cardId} style={styles.summaryRow}>
                      <span style={styles.summaryName}>{CARDS[cardId]?.name ?? cardId}</span>
                      <span style={styles.summaryCount}>×{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Battlefields */}
            {battlefieldIds.length === 3 && (
              <div style={styles.deckSummary}>
                <h4 style={styles.summaryTitle}>Battlefields</h4>
                <div style={styles.summaryGrid}>
                  {battlefieldIds.map((bfId, i) => (
                    <div key={bfId} style={styles.summaryRow}>
                      <span style={styles.summaryName}>{CARDS[bfId]?.name ?? bfId}</span>
                      <span style={styles.summaryCount}>×1</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rune deck summary */}
            {runeIds.length > 0 && (
              <div style={styles.deckSummary}>
                <h4 style={styles.summaryTitle}>Rune Deck ({runeCount})</h4>
                <div style={styles.summaryGrid}>
                  {Object.entries(groupBy(runeIds)).map(([cardId, count]) => (
                    <div key={cardId} style={styles.summaryRow}>
                      <span style={styles.summaryName}>{CARDS[cardId]?.name ?? cardId}</span>
                      <span style={styles.summaryCount}>×{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sideboard summary */}
            {sideboardIds.length > 0 && (
              <div style={styles.deckSummary}>
                <h4 style={styles.summaryTitle}>Sideboard ({sideboardCount})</h4>
                <div style={styles.summaryGrid}>
                  {Object.entries(groupBy(sideboardIds)).map(([cardId, count]) => (
                    <div key={cardId} style={styles.summaryRow}>
                      <span style={styles.summaryName}>{CARDS[cardId]?.name ?? cardId}</span>
                      <span style={styles.summaryCount}>×{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function extractChampionTag(name: string): string {
  const comma = name.indexOf(',');
  return comma !== -1 ? name.slice(0, comma).trim() : name.trim();
}

function pickerLabel(t: 'all' | 'units' | 'spells' | 'gears' | 'indeck'): string {
  const labels = { all: 'All', units: 'Units', spells: 'Spells', gears: 'Gear', indeck: 'In Deck' };
  return labels[t] ?? t;
}

function pickerCount(t: 'all' | 'units' | 'spells' | 'gears' | 'indeck'): number {
  // Counts are shown via mainDeckCount in the UI; this returns 0 to avoid stale closures
  return 0;
}

// ─── Card Image ────────────────────────────────────────────

const CARD_TYPE_COLORS: Record<string, string> = {
  Legend:     '#c9a227',
  Champion:   '#4a90d9',
  Unit:       '#e05a5a',
  Spell:      '#7b5ea7',
  Gear:       '#50c8a0',
  Rune:       '#9b59b6',
  Battlefield:'#c0392b',
};

function cardGradient(id: string, type: string): string {
  const color = CARD_TYPE_COLORS[type] ?? '#555';
  const hue = Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  return `linear-gradient(135deg, hsl(${hue},40%,22%) 0%, hsl(${(hue+30)%360},35%,18%) 100%)`;
}

function CardArt({ cardId, cardType, imageUrl }: { cardId: string; cardType: string; imageUrl?: string }) {
  const color = CARD_TYPE_COLORS[cardType] ?? '#888';

  if (imageUrl) {
    return (
      <div style={{ position: 'relative', width: '120px', height: '160px', borderRadius: '12px 12px 0 0', overflow: 'hidden', background: '#111' }}>
        <img
          src={imageUrl}
          alt={cardId}
          width={120}
          height={160}
          style={{
            display: 'block',
            width: '120px',
            height: '160px',
            objectFit: 'cover',
            objectPosition: 'center top',
          }}
          onError={e => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  // Fallback placeholder
  const hue = Math.abs(cardId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  return (
    <div style={{
      width: '120px', height: '160px', borderRadius: '12px 12px 0 0',
      background: `linear-gradient(135deg, hsl(${hue},40%,22%), hsl(${(hue+35)%360},35%,12%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderBottom: `3px solid ${color}`,
    }}>
      <span style={{ color, fontSize: '11px', fontWeight: 'bold', opacity: 0.6 }}>{cardType[0]}</span>
    </div>
  );
}

// ─── Step card (legend / champion selection with hover enlarge) ──

interface StepCardProps {
  card: CardDefinition;
  selected: boolean;
  count?: number;
  cardType: string;
  onClick: () => void;
}

function StepCard({ card, selected, count = 0, cardType, onClick }: StepCardProps) {
  const [hovered, setHovered] = useState(false);
  const [hoverPos, setHoverPos] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const ASPECT = 744 / 1039;

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Calculate max image size (520px tall target, clamped to viewport)
    let imgH = Math.min(520, window.innerHeight - 32);
    let imgW = imgH * ASPECT;

    // If image would overflow right edge of viewport, try left side
    if (rect.right + imgW + 32 > window.innerWidth) {
      imgW = Math.min(rect.left - 32, 520 * ASPECT);
      imgH = imgW / ASPECT;
    }

    imgW = Math.max(60, imgW);
    imgH = Math.max(80, imgH);

    // Position: right of card first, then left if needed
    let left = rect.right + 12;
    if (left + imgW > window.innerWidth - 16) {
      left = rect.left - imgW - 12;
    }
    left = Math.max(16, left);
    // Upper bound: prevent right edge overflow
    left = Math.min(left, window.innerWidth - imgW - 16);

    // Vertical: center on card, clamped to viewport
    let top = rect.top + rect.height / 2 - imgH / 2;
    top = Math.max(16, top);
    top = Math.min(top, window.innerHeight - imgH - 16);

    setHoverPos({ left, top, width: imgW, height: imgH });
    setHovered(true);
  };

  return (
    <div
      style={{
        ...styles.legendCard,
        ...(selected ? styles.legendCardSelected : {}),
      }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      title={card.name}
    >
      <CardArt cardId={card.id} cardType={cardType} imageUrl={card.imageUrl} />
      <div style={styles.cardBtnLegendName}>
        {card.championName ? `${card.championName}, ${card.name}` : card.name}
      </div>
      {count > 0 && <div style={styles.cardBtnCount}>{count}</div>}

      {/* Hover enlarged image — portal so opacity is never inherited from parent */}
      {hovered && ReactDOM.createPortal(
        <div style={{
          ...styles.cardHover,
          left: hoverPos.left,
          top: hoverPos.top,
          width: hoverPos.width,
          height: hoverPos.height,
        }}>
          <img
            src={card.imageUrl}
            alt={card.name}
            style={styles.cardHoverImg}
          />
        </div>,
        document.getElementById('card-hover-portal')!
      )}
    </div>
  );
}

// ─── Card Button ───────────────────────────────────────────

interface CardButtonProps {
  card: CardDefinition;
  count: number;
  maxCount: number;
  selected?: boolean;
  onClick: () => void;
  onRightClick?: () => void;
}

function CardButton({ card, count, maxCount, selected, onClick, onRightClick }: CardButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [hoverPos, setHoverPos] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const ASPECT = 744 / 1039;

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let imgH = Math.min(520, window.innerHeight - 32);
    let imgW = imgH * ASPECT;

    if (rect.right + imgW + 32 > window.innerWidth) {
      imgW = Math.min(rect.left - 32, 520 * ASPECT);
      imgH = imgW / ASPECT;
    }

    imgW = Math.max(60, imgW);
    imgH = Math.max(80, imgH);

    let left = rect.right + 12;
    if (left + imgW > window.innerWidth - 16) {
      left = rect.left - imgW - 12;
    }
    left = Math.max(16, left);
    left = Math.min(left, window.innerWidth - imgW - 16);

    let top = rect.top + rect.height / 2 - imgH / 2;
    top = Math.max(16, top);
    top = Math.min(top, window.innerHeight - imgH - 16);

    setHoverPos({ left, top, width: imgW, height: imgH });
    setHovered(true);
  };

  return (
    <div
      style={{
        ...styles.cardBtn,
        ...(selected ? styles.cardBtnSelected : {}),
        ...(count >= maxCount ? styles.cardBtnFull : {}),
      }}
      onClick={onClick}
      onContextMenu={e => { e.preventDefault(); onRightClick?.(); }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      title={card.name}
    >
      <CardArt cardId={card.id} cardType={card.type} imageUrl={card.imageUrl} />

      {/* Card name below image */}
      <div style={card.type === 'Legend' ? styles.cardBtnLegendName : styles.cardBtnName}>
        {card.type === 'Legend' && card.championName
          ? `${card.championName}, ${card.name}`
          : card.name}
      </div>

      {/* Copy count badge */}
      {count > 0 && <div style={styles.cardBtnCount}>{count}</div>}

      {/* Hover enlarged image — portal so opacity is never inherited from parent */}
      {hovered && ReactDOM.createPortal(
        <div style={{
          ...styles.cardHover,
          left: hoverPos.left,
          top: hoverPos.top,
          width: hoverPos.width,
          height: hoverPos.height,
        }}>
          <img
            src={card.imageUrl}
            alt={card.name}
            style={styles.cardHoverImg}
          />
        </div>,
        document.getElementById('card-hover-portal')!
      )}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
    background: 'linear-gradient(135deg, #0f0f23, #1a1a2e)', color: 'white',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  backBtn: {
    padding: '8px 16px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: '#d1d5db', cursor: 'pointer', fontSize: '13px',
  },
  title: { flex: 1, fontSize: '22px', fontWeight: 700, color: '#fbbf24', margin: 0 },
  newBtn: {
    padding: '8px 16px', background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontWeight: 600,
  },
  tabs: {
    display: 'flex', gap: '4px', padding: '12px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  tab: {
    padding: '8px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#9ca3af', cursor: 'pointer', fontSize: '13px',
  },
  tabActive: { background: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf24', color: '#fbbf24' },
  deckList: {
    flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px',
  },
  emptyMsg: { color: '#6b7280', textAlign: 'center', marginTop: '48px' },
  deckCard: {
    background: 'rgba(30,30,60,0.9)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px', padding: '16px 20px', cursor: 'pointer', position: 'relative',
    transition: 'border-color 0.15s',
  },
  deckCardName: { fontSize: '16px', fontWeight: 600, color: '#fbbf24', marginBottom: '4px' },
  deckCardMeta: { fontSize: '12px', color: '#9ca3af' },
  deleteBtn: {
    position: 'absolute', top: '12px', right: '12px', background: 'rgba(239,68,68,0.2)',
    border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#f87171',
    cursor: 'pointer', width: '24px', height: '24px', fontSize: '11px',
  },
  editor: { flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' },
  cardPicker: { flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' },
  pickerTabs: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  pickerTab: {
    padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: '#9ca3af', cursor: 'pointer', fontSize: '11px',
  },
  pickerTabActive: { background: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf24', color: '#fbbf24' },
  costFilterBtn: {
    padding: '4px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'inherit',
  },
  costFilterBtnActive: {
    background: 'rgba(74,144,217,0.2)',
    border: '1px solid #4a90d9',
    color: '#4a90d9',
  },
  pickerSection: { display: 'flex', flexDirection: 'column', gap: '8px' },
  pickerSectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: '13px', color: '#fbbf24', fontWeight: 600, margin: 0 },
  sectionCount: { fontSize: '11px', color: '#6b7280' },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px' },
  cardBtn: {
    background: 'rgba(20,20,40,0.9)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '12px', cursor: 'pointer', position: 'relative',
    transition: 'all 0.12s', display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '0', overflow: 'visible',
  },
  cardBtnSelected: { border: '2px solid #fbbf24', background: 'rgba(251,191,36,0.1)' },
  cardBtnFull: { opacity: 0.5 },
  cardBtnName: { fontSize: '11px', fontWeight: 600, color: '#e5e7eb', lineHeight: 1.3, textAlign: 'center', padding: '4px 4px 6px', width: '100%', boxSizing: 'border-box', background: 'rgba(15,15,35,0.85)' },
  cardBtnLegendName: { fontSize: '11px', fontWeight: 700, color: '#fbbf24', lineHeight: 1.3, textAlign: 'center', padding: '4px 4px 6px', width: '100%', boxSizing: 'border-box', background: 'rgba(201,162,39,0.15)', borderTop: '1px solid rgba(201,162,39,0.3)' },
  cardBtnCount: {
    position: 'absolute', top: '4px', right: '4px', background: '#fbbf24',
    color: '#0f0f23', borderRadius: '50%', width: '18px', height: '18px',
    fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  cardHover: {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'none',
    overflow: 'hidden',
    borderRadius: '12px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.9)',
  },
  cardHoverImg: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: 'center top',
    opacity: 1,
  },
  configPanel: {
    width: '320px', flexShrink: 0, background: 'rgba(20,20,40,0.9)',
    borderLeft: '1px solid rgba(255,255,255,0.08)', padding: '20px',
    overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px',
  },
  configTitle: { fontSize: '18px', fontWeight: 700, color: '#fbbf24', margin: 0 },
  configLegend: {
    display: 'flex', alignItems: 'center', gap: '10px',
    background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
    padding: '8px',
  },
  configLegendLabel: { fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1px' },
  configLegendName: { fontSize: '13px', color: '#e5e7eb', fontWeight: 600 },
  infoSection: { background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px' },
  infoTitle: { fontSize: '10px', color: '#9ca3af', letterSpacing: '1px', marginBottom: '8px' },
  label: { fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1px' },
  legendName: { fontSize: '14px', color: '#e5e7eb', padding: '6px 0' },
  input: {
    padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'white', fontSize: '14px', width: '100%', boxSizing: 'border-box',
  },
  select: {
    padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'white', fontSize: '14px', width: '100%',
  },
  statsRow: { display: 'flex', gap: '16px', fontSize: '13px', color: '#9ca3af' },
  validationBox: { background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px', fontSize: '12px' },
  validationErrors: { display: 'flex', flexDirection: 'column', gap: '4px' },
  validationError: { color: '#f87171' },
  validationWarn: { color: '#fbbf24' },
  validationOk: { color: '#4ade80' },
  errorMsg: { color: '#f87171', fontSize: '13px', margin: 0 },
  actions: { display: 'flex', gap: '8px' },
  validateBtn: {
    flex: 1, padding: '10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: '#d1d5db', cursor: 'pointer', fontSize: '14px',
  },
  saveBtn: {
    flex: 2, padding: '10px', background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
  },
  deckSummary: { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px', marginTop: '4px' },
  summaryTitle: { fontSize: '12px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' },
  summaryGrid: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflow: 'auto' },
  summaryRow: { display: 'flex', justifyContent: 'space-between', fontSize: '12px' },
  summaryName: { color: '#d1d5db' },
  summaryCount: { color: '#fbbf24' },

  // ── Legend step styles ────────────────────────────────────
  legendStep: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: '24px',
    padding: '24px', overflow: 'auto',
  },
  legendStepHeader: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  legendStepTitle: { fontSize: '22px', fontWeight: 700, color: '#fbbf24', margin: 0 },
  legendStepSubtitle: { fontSize: '13px', color: '#9ca3af', margin: 0 },
  legendSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
  championSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
  legendGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px',
  },
  championGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px',
  },
  legendCard: {
    background: 'rgba(20,20,40,0.9)', border: '2px solid rgba(255,255,255,0.12)',
    borderRadius: '12px', cursor: 'pointer', position: 'relative',
    transition: 'all 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'center',
    overflow: 'visible',
  },
  legendCardSelected: { border: '2px solid #fbbf24', background: 'rgba(251,191,36,0.1)', boxShadow: '0 0 20px rgba(251,191,36,0.25)' },
  legendProceed: { display: 'flex', justifyContent: 'center', paddingTop: '8px' },
  proceedBtn: {
    padding: '14px 32px', background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer',
    fontWeight: 700, fontSize: '15px',
    boxShadow: '0 4px 20px rgba(217,119,6,0.4)',
  },
  backStepBtn: {
    position: 'absolute', top: '16px', left: '16px', zIndex: 10,
    padding: '6px 14px', background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
    color: '#9ca3af', cursor: 'pointer', fontSize: '12px',
  },
  championStrip: {
    display: 'flex', alignItems: 'center', gap: '16px',
    background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '12px 16px',
  },
  championStripCard: { display: 'flex', alignItems: 'center', gap: '10px' },
  championStripLabel: { fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px' },
  championStripName: { fontSize: '13px', fontWeight: 600, color: '#e5e7eb' },
  championStripArrow: { fontSize: '18px', color: '#fbbf24' },
  championStripDomains: {
    marginLeft: 'auto', fontSize: '11px', color: '#fbbf24',
    background: 'rgba(251,191,36,0.1)', padding: '4px 10px', borderRadius: '6px',
  },
  searchBarWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchBar: {
    width: '100%', padding: '10px 36px 10px 14px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'white', fontSize: '13px',
    boxSizing: 'border-box',
  },
  searchClear: {
    position: 'absolute', right: '8px', background: 'none', border: 'none',
    color: '#6b7280', cursor: 'pointer', fontSize: '12px', padding: '4px',
  },

  // ── 6-step nav layout ──────────────────────────────────────
  editorWithNav: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  navPane: {
    width: '200px', flexShrink: 0,
    background: 'rgba(15,15,35,0.95)',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    padding: '20px 12px',
    display: 'flex', flexDirection: 'column', gap: '4px',
    overflowY: 'auto',
  },
  navTitle: {
    fontSize: '10px', color: '#6b7280', textTransform: 'uppercase',
    letterSpacing: '1.5px', marginBottom: '12px', fontWeight: 600,
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 12px', borderRadius: '8px',
    background: 'transparent', border: '1px solid transparent',
    color: '#9ca3af', cursor: 'pointer', textAlign: 'left',
    fontSize: '12px', transition: 'all 0.12s', width: '100%',
  },
  navItemActive: {
    background: 'rgba(251,191,36,0.12)',
    border: '1px solid rgba(251,191,36,0.4)',
    color: '#fbbf24', fontWeight: 600,
  },
  navItemDone: {
    color: '#6b7280',
  },
  navNum: {
    width: '20px', height: '20px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '11px', fontWeight: 700, flexShrink: 0,
  },
  navLabel: { flex: 1 },
  navCheck: { color: '#4ade80', fontSize: '12px' },
  navActions: {
    display: 'flex', gap: '8px', marginTop: '20px',
  },
  navBack: {
    flex: 1, padding: '8px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    color: '#9ca3af', cursor: 'pointer', fontSize: '12px',
  },
  navNext: {
    flex: 1, padding: '8px', background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none', borderRadius: '8px',
    color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '12px',
  },
  stepContent: {
    flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column',
  },
  stepPane: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: '20px',
    padding: '24px', overflow: 'auto',
  },
  stepHeader: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  stepTitle: { fontSize: '22px', fontWeight: 700, color: '#fbbf24', margin: 0 },
  stepSubtitle: { fontSize: '13px', color: '#9ca3af', margin: 0 },
  bfSelectCount: { fontSize: '14px', color: '#9ca3af' },
  deckCount: { fontSize: '14px', color: '#9ca3af', marginBottom: '8px' },

  // ── Import Modal ────────────────────────────────────────────
  importBtn: {
    padding: '8px 14px',
    background: 'rgba(59,130,246,0.15)',
    border: '1px solid rgba(59,130,246,0.4)',
    borderRadius: '8px',
    color: '#93c5fd',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  importOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  importModal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '16px',
    padding: '28px',
    width: '580px',
    maxWidth: '95vw',
    boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
  },
  importModalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '12px',
  },
  importModalTitle: { fontSize: '20px', fontWeight: 700, color: '#fbbf24', margin: 0 },
  importModalClose: {
    background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px',
    color: '#9ca3af', cursor: 'pointer', fontSize: '14px', padding: '6px 10px',
  },
  importModalHint: {
    fontSize: '13px', color: '#9ca3af', marginBottom: '16px',
    lineHeight: 1.5,
  },
  importTextarea: {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px',
    color: '#e5e7eb',
    fontSize: '12px',
    fontFamily: 'monospace',
    padding: '12px',
    resize: 'vertical' as const,
    minHeight: '120px',
  },
  importError: {
    marginTop: '10px',
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  },
  importModalActions: {
    display: 'flex', gap: '10px', justifyContent: 'flex-end',
    marginTop: '16px',
  },
  importCancel: {
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  importConfirm: {
    padding: '10px 24px',
    background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
  },
};
