/* ============================================================
   arcade/games/checkers.js — Checkers: rules, rendering, networking
   ============================================================ */

import { registerGame } from '../engine.js';
import {
  VIRTUAL_W, VIRTUAL_H, clear, drawRect, drawCircle,
  drawText, strokeCircle, strokeRect,
} from '../renderer.js';
import { consumeClick, getMousePos } from '../input.js';
import { MSG, encodeMove, encodeMoveAck, decodeMessage } from '../net.js';

/* ---------- Constants ---------- */

const EMPTY  = 0;
const W_MAN  = 1;
const W_KING = 2;
const B_MAN  = 3;
const B_KING = 4;

const SQ = 40;
const BOARD_X = (VIRTUAL_W - SQ * 8) / 2;
const BOARD_Y = (VIRTUAL_H - SQ * 8) / 2;

function isWhite(p) { return p === W_MAN || p === W_KING; }
function isBlack(p) { return p === B_MAN || p === B_KING; }
function isKing(p) { return p === W_KING || p === B_KING; }
function pieceColor(p) { return p === EMPTY ? -1 : (isWhite(p) ? 0 : 1); }

/* ---------- Board Setup ---------- */

// Checkers uses only dark squares. We index 0–31 for the 32 playable squares.
// Board mapping: playable square index → (row, col) on 8×8 board.
// Row 0 is top (black's side), row 7 is bottom (white's side).

function sqToRC(sq) {
  const r = sq >> 2;
  const c = (sq & 3) * 2 + (r % 2 === 0 ? 1 : 0);
  return { r, c };
}

function rcToSq(r, c) {
  if ((r + c) % 2 === 0) return -1;  // not a dark square
  return (r * 4) + Math.floor(c / 2);
}

function initialBoard() {
  const b = new Uint8Array(32);
  for (let i = 0; i < 12; i++) b[i] = B_MAN;    // rows 0-2
  for (let i = 20; i < 32; i++) b[i] = W_MAN;   // rows 5-7
  return b;
}

function cloneBoard(b) { return new Uint8Array(b); }

/* ---------- Move Generation ---------- */

function getJumps(board, sq, color) {
  const jumps = [];
  const p = board[sq];
  const { r, c } = sqToRC(sq);
  const dirs = isKing(p)
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : color === 0
      ? [[-1, -1], [-1, 1]]    // white moves up
      : [[1, -1], [1, 1]];     // black moves down

  for (const [dr, dc] of dirs) {
    const mr = r + dr, mc = c + dc;      // middle square (captured piece)
    const lr = r + dr * 2, lc = c + dc * 2;  // landing square
    if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue;
    const midSq = rcToSq(mr, mc);
    const landSq = rcToSq(lr, lc);
    if (midSq < 0 || landSq < 0) continue;
    const mid = board[midSq];
    if (mid === EMPTY) continue;
    if (pieceColor(mid) === color) continue;  // can't jump own piece
    if (board[landSq] !== EMPTY) continue;     // landing must be empty
    jumps.push({ from: sq, to: landSq, captured: midSq });
  }
  return jumps;
}

function getSimpleMoves(board, sq, color) {
  const moves = [];
  const p = board[sq];
  const { r, c } = sqToRC(sq);
  const dirs = isKing(p)
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : color === 0
      ? [[-1, -1], [-1, 1]]
      : [[1, -1], [1, 1]];

  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
    const destSq = rcToSq(nr, nc);
    if (destSq < 0) continue;
    if (board[destSq] !== EMPTY) continue;
    moves.push({ from: sq, to: destSq });
  }
  return moves;
}

function generateMoves(board, color) {
  // Jumps are mandatory — if any jump exists, only jumps are allowed
  let allJumps = [];
  for (let i = 0; i < 32; i++) {
    if (board[i] === EMPTY || pieceColor(board[i]) !== color) continue;
    allJumps = allJumps.concat(getJumps(board, i, color));
  }
  if (allJumps.length > 0) return allJumps;

  let allMoves = [];
  for (let i = 0; i < 32; i++) {
    if (board[i] === EMPTY || pieceColor(board[i]) !== color) continue;
    allMoves = allMoves.concat(getSimpleMoves(board, i, color));
  }
  return allMoves;
}

function getMultiJumps(board, sq, color) {
  // After capturing, check if the same piece can jump again
  const chains = [];

  function search(b, currentSq, chain) {
    const jumps = getJumps(b, currentSq, color);
    if (jumps.length === 0) {
      if (chain.length > 0) chains.push([...chain]);
      return;
    }
    for (const jump of jumps) {
      // Avoid re-capturing the same square in a chain
      if (chain.some(j => j.captured === jump.captured)) continue;
      const nb = cloneBoard(b);
      nb[jump.to] = nb[jump.from];
      nb[jump.from] = EMPTY;
      nb[jump.captured] = EMPTY;
      chain.push(jump);
      search(nb, jump.to, chain);
      chain.pop();
    }
  }

  const jumps = getJumps(board, sq, color);
  for (const jump of jumps) {
    const nb = cloneBoard(board);
    nb[jump.to] = nb[jump.from];
    nb[jump.from] = EMPTY;
    nb[jump.captured] = EMPTY;
    search(nb, jump.to, [jump]);
  }

  return chains;
}

/* ---------- Move Application ---------- */

function applyMove(board, move) {
  board[move.to] = board[move.from];
  board[move.from] = EMPTY;
  if (move.captured !== undefined) {
    board[move.captured] = EMPTY;
  }
  // King promotion
  const { r } = sqToRC(move.to);
  if (board[move.to] === W_MAN && r === 0) board[move.to] = W_KING;
  if (board[move.to] === B_MAN && r === 7) board[move.to] = B_KING;
}

function applyMoveChain(board, chain) {
  for (const move of chain) {
    board[move.to] = board[move.from];
    board[move.from] = EMPTY;
    board[move.captured] = EMPTY;
  }
  // King promotion at final position
  const last = chain[chain.length - 1];
  const { r } = sqToRC(last.to);
  if (board[last.to] === W_MAN && r === 0) board[last.to] = W_KING;
  if (board[last.to] === B_MAN && r === 7) board[last.to] = B_KING;
}

/* ---------- Game State ---------- */

function createGameState() {
  return {
    board: initialBoard(),
    turn: 0,                   // 0 = white (bottom), 1 = black (top)
    selected: -1,              // selected playable square index
    legalMoves: [],            // available moves for selected piece
    jumpChains: [],            // multi-jump chains for selected piece
    midJump: false,            // in the middle of a multi-jump
    lastMove: null,
    status: 'playing',         // 'playing' | 'win-white' | 'win-black' | 'draw'
    moveSeq: 0,
    whiteCount: 12,
    blackCount: 12,
  };
}

function countPieces(board) {
  let w = 0, b = 0;
  for (let i = 0; i < 32; i++) {
    if (isWhite(board[i])) w++;
    if (isBlack(board[i])) b++;
  }
  return { w, b };
}

function updateStatus(gs) {
  const { w, b } = countPieces(gs.board);
  gs.whiteCount = w;
  gs.blackCount = b;
  if (w === 0) { gs.status = 'win-black'; return; }
  if (b === 0) { gs.status = 'win-white'; return; }
  const moves = generateMoves(gs.board, gs.turn);
  if (moves.length === 0) {
    gs.status = gs.turn === 0 ? 'win-black' : 'win-white';
    return;
  }
  gs.status = 'playing';
}

/* ---------- Rendering ---------- */

const LIGHT_SQ = '#d4b896';
const DARK_SQ = '#8b5e3c';
const SELECT_COLOR = 'rgba(255, 255, 0, 0.4)';
const MOVE_DOT = 'rgba(0, 200, 0, 0.5)';
const LAST_MOVE_COLOR = 'rgba(155, 199, 0, 0.3)';

function renderBoard(ctx, alpha) {
  const gs = ctx.state;
  const flipped = ctx.localPlayerId === 1;

  clear('#2c2c2c');

  // Draw board
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const dr = flipped ? 7 - r : r;
      const dc = flipped ? 7 - c : c;
      const x = BOARD_X + dc * SQ;
      const y = BOARD_Y + dr * SQ;
      const isDark = (r + c) % 2 === 1;
      drawRect(x, y, SQ, SQ, isDark ? DARK_SQ : LIGHT_SQ);

      if (!isDark) continue;
      const sq = rcToSq(r, c);
      if (sq < 0) continue;

      // Last move highlight
      if (gs.lastMove && (gs.lastMove.from === sq || gs.lastMove.to === sq)) {
        drawRect(x, y, SQ, SQ, LAST_MOVE_COLOR);
      }

      // Selected highlight
      if (gs.selected === sq) {
        drawRect(x, y, SQ, SQ, SELECT_COLOR);
      }
    }
  }

  // Legal move indicators
  const destinations = new Set();
  for (const m of gs.legalMoves) destinations.add(m.to);
  for (const chain of gs.jumpChains) {
    if (chain.length > 0) destinations.add(chain[0].to);
  }
  for (const dest of destinations) {
    const { r, c } = sqToRC(dest);
    const dr = flipped ? 7 - r : r;
    const dc = flipped ? 7 - c : c;
    const x = BOARD_X + dc * SQ + SQ / 2;
    const y = BOARD_Y + dr * SQ + SQ / 2;
    drawCircle(x, y, 6, MOVE_DOT);
  }

  // Pieces
  for (let i = 0; i < 32; i++) {
    const p = gs.board[i];
    if (p === EMPTY) continue;
    const { r, c } = sqToRC(i);
    const dr = flipped ? 7 - r : r;
    const dc = flipped ? 7 - c : c;
    const x = BOARD_X + dc * SQ + SQ / 2;
    const y = BOARD_Y + dr * SQ + SQ / 2;
    const color = isWhite(p) ? '#f5f5dc' : '#2a1a0a';
    const outline = isWhite(p) ? '#a08060' : '#111';

    drawCircle(x, y, SQ / 2 - 4, color);
    strokeCircle(x, y, SQ / 2 - 4, outline, 2);

    if (isKing(p)) {
      drawText('♛', x, y + 2, {
        size: 18, align: 'center', baseline: 'middle',
        color: isWhite(p) ? '#855' : '#da5',
        font: 'serif',
      });
    }
  }

  // Score
  drawText(`White: ${gs.whiteCount}`, BOARD_X, BOARD_Y + 8 * SQ + 16, {
    size: 11, color: '#ccc',
  });
  drawText(`Black: ${gs.blackCount}`, BOARD_X + SQ * 8, BOARD_Y + 8 * SQ + 16, {
    size: 11, color: '#ccc', align: 'right',
  });

  // Status
  const statusY = BOARD_Y - 14;
  if (gs.status === 'win-white') {
    drawText('White wins!', VIRTUAL_W / 2, statusY, {
      size: 16, align: 'center', color: '#ff6', bold: true,
    });
  } else if (gs.status === 'win-black') {
    drawText('Black wins!', VIRTUAL_W / 2, statusY, {
      size: 16, align: 'center', color: '#ff6', bold: true,
    });
  } else {
    const turnStr = gs.turn === 0 ? 'White' : 'Black';
    const youStr = gs.turn === ctx.localPlayerId ? ' (your turn)' : '';
    drawText(`${turnStr} to move${youStr}`, VIRTUAL_W / 2, statusY, {
      size: 12, align: 'center', color: '#ccc',
    });
  }
}

/* ---------- Click Handling ---------- */

function handleClick(ctx) {
  if (!consumeClick()) return;
  const gs = ctx.state;
  if (gs.status !== 'playing') return;
  if (gs.turn !== ctx.localPlayerId) return;

  const mouse = getMousePos();
  const flipped = ctx.localPlayerId === 1;

  const boardCol = Math.floor((mouse.x - BOARD_X) / SQ);
  const boardRow = Math.floor((mouse.y - BOARD_Y) / SQ);
  if (boardCol < 0 || boardCol > 7 || boardRow < 0 || boardRow > 7) {
    gs.selected = -1;
    gs.legalMoves = [];
    gs.jumpChains = [];
    return;
  }

  const r = flipped ? 7 - boardRow : boardRow;
  const c = flipped ? 7 - boardCol : boardCol;
  if ((r + c) % 2 === 0) return;  // light square, ignore
  const clickSq = rcToSq(r, c);
  if (clickSq < 0) return;

  // Check if clicking a move destination
  const simpleMove = gs.legalMoves.find(m => m.to === clickSq);
  if (simpleMove) {
    executeAndSend(ctx, [simpleMove]);
    return;
  }

  // Check multi-jump chains
  const jumpChain = gs.jumpChains.find(chain => chain.length > 0 && chain[0].to === clickSq);
  if (jumpChain) {
    executeAndSend(ctx, jumpChain);
    return;
  }

  // Select piece
  const p = gs.board[clickSq];
  if (p !== EMPTY && pieceColor(p) === ctx.localPlayerId) {
    gs.selected = clickSq;
    // Check for multi-jumps first
    const chains = getMultiJumps(gs.board, clickSq, gs.turn);
    if (chains.length > 0) {
      gs.legalMoves = [];
      gs.jumpChains = chains;
    } else {
      gs.jumpChains = [];
      gs.legalMoves = generateMoves(gs.board, gs.turn).filter(m => m.from === clickSq);
    }
  } else {
    gs.selected = -1;
    gs.legalMoves = [];
    gs.jumpChains = [];
  }
}

function executeAndSend(ctx, moveChain) {
  const gs = ctx.state;

  if (moveChain.length === 1 && moveChain[0].captured === undefined) {
    // Simple move
    applyMove(gs.board, moveChain[0]);
    gs.lastMove = { from: moveChain[0].from, to: moveChain[0].to };
  } else {
    // Jump chain
    applyMoveChain(gs.board, moveChain);
    gs.lastMove = { from: moveChain[0].from, to: moveChain[moveChain.length - 1].to };
  }

  gs.turn = 1 - gs.turn;
  gs.selected = -1;
  gs.legalMoves = [];
  gs.jumpChains = [];
  updateStatus(gs);

  // Network send
  if (ctx.net) {
    const payload = new Uint8Array(1 + moveChain.length * 3);
    payload[0] = moveChain.length;
    for (let i = 0; i < moveChain.length; i++) {
      payload[1 + i * 3] = moveChain[i].from;
      payload[2 + i * 3] = moveChain[i].to;
      payload[3 + i * 3] = moveChain[i].captured !== undefined ? moveChain[i].captured : 255;
    }
    ctx.net.sendReliable(encodeMove(gs.moveSeq++, payload));
  }
}

/* ---------- Network Receive ---------- */

function onRemoteMove(ctx, buffer) {
  const msg = decodeMessage(buffer);
  if (msg.type !== MSG.MOVE) return;

  const gs = ctx.state;
  const p = msg.payload;
  const chainLen = p[0];
  const chain = [];
  for (let i = 0; i < chainLen; i++) {
    chain.push({
      from: p[1 + i * 3],
      to: p[2 + i * 3],
      captured: p[3 + i * 3] === 255 ? undefined : p[3 + i * 3],
    });
  }

  if (chain.length === 1 && chain[0].captured === undefined) {
    applyMove(gs.board, chain[0]);
    gs.lastMove = { from: chain[0].from, to: chain[0].to };
  } else {
    applyMoveChain(gs.board, chain);
    gs.lastMove = { from: chain[0].from, to: chain[chain.length - 1].to };
  }

  gs.turn = 1 - gs.turn;
  updateStatus(gs);

  if (ctx.net) {
    ctx.net.sendReliable(encodeMoveAck(msg.seq));
  }
}

/* ---------- Registration ---------- */

registerGame({
  key: 'checkers',
  name: 'Checkers',
  description: 'Classic checkers with multi-jumps & kings',
  icon: '⛀',
  maxPlayers: 2,
  tickRate: 30,
  netModel: 'lockstep',
  inputSchema: ['click'],

  init(ctx) {
    ctx.state = createGameState();
  },

  update(ctx) {
    handleClick(ctx);
  },

  render(ctx, prev, curr, alpha) {
    renderBoard(ctx, alpha);
  },

  serialize(ctx) {
    const gs = ctx.state;
    const data = new Uint8Array(34);
    data.set(gs.board, 0);
    data[32] = gs.turn;
    data[33] = (gs.status === 'playing' ? 0 : gs.status === 'win-white' ? 1 : 2);
    return data;
  },

  deserialize(ctx, data) {
    const gs = ctx.state;
    gs.board.set(data.subarray(0, 32));
    gs.turn = data[32];
    const s = data[33];
    gs.status = s === 0 ? 'playing' : s === 1 ? 'win-white' : 'win-black';
    const { w, b } = countPieces(gs.board);
    gs.whiteCount = w;
    gs.blackCount = b;
  },

  cleanup(ctx) {
    ctx.state = null;
  },

  onNetMessage(ctx, buffer) {
    onRemoteMove(ctx, buffer);
  },
});

export default 'checkers';
