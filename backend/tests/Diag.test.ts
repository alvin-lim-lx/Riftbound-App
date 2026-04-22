import {
  createGame,
  canAutoAdvance,
  advancePhase,
  enterPhase,
  deepClone,
} from '../src/engine/GameEngine';

const P1 = 'player_1';
const P2 = 'player_2';

describe('DIAG', () => {
  it('secondmain to end to new turn', () => {
    const baseState = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    let s = enterPhase({ ...baseState, activePlayerId: P1 }, 'FirstMain');
    expect(s.phase).toBe('FirstMain');
    console.log('turn after FirstMain:', s.turn);

    s = advancePhase(s);
    console.log('turn after Combat:', s.turn, 'phase:', s.phase);
    expect(s.phase).toBe('Combat');

    s = advancePhase(s);
    console.log('turn after SecondMain:', s.turn, 'phase:', s.phase);
    expect(s.phase).toBe('SecondMain');

    s = advancePhase(s);
    console.log('turn after End/turn:', s.turn, 'phase:', s.phase, 'activePlayerId:', s.activePlayerId);
    expect(s.turn).toBe(2);
    expect(s.activePlayerId).toBe(P2);
    expect(s.phase).toBe('Awaken');
  });
});
