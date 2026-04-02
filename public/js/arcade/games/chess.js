/* ============================================================
   arcade/games/chess.js — Chess: rules, rendering, networking
   ============================================================ */

import { registerGame } from '../engine.js';
import {
  VIRTUAL_W, VIRTUAL_H, clear, drawRect, drawCircle,
  drawText, strokeRect, drawRoundRect, pageToVirtual,
} from '../renderer.js';
import { consumeClick, getMousePos } from '../input.js';
import { MSG, encodeMove, encodeMoveAck, decodeMessage } from '../net.js';

/* ---------- Piece Constants ---------- */

const EMPTY  = 0x00;
const W_PAWN = 0x01; const W_KNIGHT = 0x02; const W_BISHOP = 0x03;
const W_ROOK = 0x04; const W_QUEEN  = 0x05; const W_KING   = 0x06;
const B_PAWN = 0x81; const B_KNIGHT = 0x82; const B_BISHOP = 0x83;
const B_ROOK = 0x84; const B_QUEEN  = 0x85; const B_KING   = 0x86;

const PIECE_CHARS = {
  [W_KING]: '♔', [W_QUEEN]: '♕', [W_ROOK]: '♖',
  [W_BISHOP]: '♗', [W_KNIGHT]: '♘', [W_PAWN]: '♙',
  [B_KING]: '♚', [B_QUEEN]: '♛', [B_ROOK]: '♜',
  [B_BISHOP]: '♝', [B_KNIGHT]: '♞', [B_PAWN]: '♟',
};

function isWhite(p) { return p > 0 && p < 0x80; }
function isBlack(p) { return p >= 0x80; }
function pieceColor(p) { return p === EMPTY ? -1 : (isWhite(p) ? 0 : 1); }
function pieceType(p) { return p & 0x0F; }

/* ---------- Board Layout ---------- */

const SQ = 40;             // square size (virtual px)
const BOARD_X = (VIRTUAL_W - SQ * 8) / 2;
const BOARD_Y = (VIRTUAL_H - SQ * 8) / 2;

/* ---------- Board Helpers ---------- */

function initialBoard() {
  const b = new Uint8Array(64);
  const backRow = [W_ROOK, W_KNIGHT, W_BISHOP, W_QUEEN, W_KING, W_BISHOP, W_KNIGHT, W_ROOK];
  for (let i = 0; i < 8; i++) {
    b[i] = backRow[i] | 0x80;  // black back row (rank 8)
    b[8 + i] = B_PAWN;         // black pawns (rank 7)
    b[48 + i] = W_PAWN;        // white pawns (rank 2)
    b[56 + i] = backRow[i];    // white back row (rank 1)
  }
  return b;
}

function rc(sq) { return { r: sq >> 3, c: sq & 7 }; }
function sq(r, c) { return (r << 3) | c; }
function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function cloneBoard(b) { return new Uint8Array(b); }

/* ---------- Move Generation ---------- */

function generateMoves(board, color, state) {
  const moves = [];
  const friendly = color === 0 ? isWhite : isBlack;
  const enemy = color === 0 ? isBlack : isWhite;
  const pawnDir = color === 0 ? -1 : 1;
  const pawnStart = color === 0 ? 6 : 1;
  const pawnPromo = color === 0 ? 0 : 7;

  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!friendly(p)) continue;
    const { r, c } = rc(s);
    const t = pieceType(p);

    if (t === 1) {
      // Pawn
      const fwd = sq(r + pawnDir, c);
      if (onBoard(r + pawnDir, c) && board[fwd] === EMPTY) {
        addPawnMove(moves, s, fwd, r + pawnDir, pawnPromo);
        // Double advance
        if (r === pawnStart) {
          const fwd2 = sq(r + pawnDir * 2, c);
          if (board[fwd2] === EMPTY) {
            moves.push({ from: s, to: fwd2, flag: 'double' });
          }
        }
      }
      // Captures
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (!onBoard(r + pawnDir, nc)) continue;
        const cap = sq(r + pawnDir, nc);
        if (enemy(board[cap])) {
          addPawnMove(moves, s, cap, r + pawnDir, pawnPromo);
        }
        // En passant
        if (state.enPassant === cap) {
          moves.push({ from: s, to: cap, flag: 'ep' });
        }
      }
    } else if (t === 2) {
      // Knight
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nc = c + dc;
        if (!onBoard(nr, nc)) continue;
        const dest = sq(nr, nc);
        if (!friendly(board[dest])) moves.push({ from: s, to: dest });
      }
    } else if (t === 3 || t === 4 || t === 5) {
      // Bishop (3), Rook (4), Queen (5)
      const dirs = t === 3
        ? [[-1,-1],[-1,1],[1,-1],[1,1]]
        : t === 4
          ? [[-1,0],[1,0],[0,-1],[0,1]]
          : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (onBoard(nr, nc)) {
          const dest = sq(nr, nc);
          if (friendly(board[dest])) break;
          moves.push({ from: s, to: dest });
          if (enemy(board[dest])) break;
          nr += dr; nc += dc;
        }
      }
    } else if (t === 6) {
      // King
      for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        const nr = r + dr, nc = c + dc;
        if (!onBoard(nr, nc)) continue;
        const dest = sq(nr, nc);
        if (!friendly(board[dest])) moves.push({ from: s, to: dest });
      }
      // Castling
      if (color === 0) {
        if (state.castling[0] && board[61] === EMPTY && board[62] === EMPTY &&
            board[63] === W_ROOK && !isAttacked(board, 60, 1) &&
            !isAttacked(board, 61, 1) && !isAttacked(board, 62, 1)) {
          moves.push({ from: 60, to: 62, flag: 'castle-k' });
        }
        if (state.castling[1] && board[59] === EMPTY && board[58] === EMPTY &&
            board[57] === EMPTY && board[56] === W_ROOK && !isAttacked(board, 60, 1) &&
            !isAttacked(board, 59, 1) && !isAttacked(board, 58, 1)) {
          moves.push({ from: 60, to: 58, flag: 'castle-q' });
        }
      } else {
        if (state.castling[2] && board[5] === EMPTY && board[6] === EMPTY &&
            board[7] === B_ROOK && !isAttacked(board, 4, 0) &&
            !isAttacked(board, 5, 0) && !isAttacked(board, 6, 0)) {
          moves.push({ from: 4, to: 6, flag: 'castle-k' });
        }
        if (state.castling[3] && board[3] === EMPTY && board[2] === EMPTY &&
            board[1] === EMPTY && board[0] === B_ROOK && !isAttacked(board, 4, 0) &&
            !isAttacked(board, 3, 0) && !isAttacked(board, 2, 0)) {
          moves.push({ from: 4, to: 2, flag: 'castle-q' });
        }
      }
    }
  }

  // Filter moves that leave own king in check
  return moves.filter(m => {
    const test = cloneBoard(board);
    applyMoveRaw(test, m, state);
    return !isInCheck(test, color);
  });
}

function addPawnMove(moves, from, to, toRow, promoRow) {
  if (toRow === promoRow) {
    for (const promo of ['q', 'r', 'b', 'n']) {
      moves.push({ from, to, flag: 'promo', promo });
    }
  } else {
    moves.push({ from, to });
  }
}

/* ---------- Board Logic ---------- */

function applyMoveRaw(board, move, state) {
  const p = board[move.from];
  board[move.to] = p;
  board[move.from] = EMPTY;

  if (move.flag === 'ep') {
    const capSq = move.to + (isWhite(p) ? 8 : -8);
    board[capSq] = EMPTY;
  } else if (move.flag === 'castle-k') {
    if (isWhite(p)) { board[61] = W_ROOK; board[63] = EMPTY; }
    else { board[5] = B_ROOK; board[7] = EMPTY; }
  } else if (move.flag === 'castle-q') {
    if (isWhite(p)) { board[59] = W_ROOK; board[56] = EMPTY; }
    else { board[3] = B_ROOK; board[0] = EMPTY; }
  } else if (move.flag === 'promo') {
    const color = isWhite(p) ? 0 : 0x80;
    const pieceMap = { q: 5, r: 4, b: 3, n: 2 };
    board[move.to] = color | pieceMap[move.promo];
  }
}

function applyMove(board, move, state) {
  const p = board[move.from];

  // Update castling rights
  const newCastling = [...state.castling];
  if (p === W_KING) { newCastling[0] = false; newCastling[1] = false; }
  if (p === B_KING) { newCastling[2] = false; newCastling[3] = false; }
  if (move.from === 63 || move.to === 63) newCastling[0] = false;
  if (move.from === 56 || move.to === 56) newCastling[1] = false;
  if (move.from === 7 || move.to === 7) newCastling[2] = false;
  if (move.from === 0 || move.to === 0) newCastling[3] = false;

  // En passant square
  let ep = -1;
  if (move.flag === 'double') {
    ep = (move.from + move.to) / 2;
  }

  applyMoveRaw(board, move, state);

  return {
    castling: newCastling,
    enPassant: ep,
    halfMoves: (pieceType(p) === 1 || board[move.to] !== EMPTY) ? 0 : state.halfMoves + 1,
    fullMoves: state.turn === 1 ? state.fullMoves + 1 : state.fullMoves,
    turn: 1 - state.turn,
  };
}

/* ---------- Attack Detection ---------- */

function isAttacked(board, targetSq, byColor) {
  const { r: tr, c: tc } = rc(targetSq);
  const enemy = byColor === 0 ? isWhite : isBlack;

  // Knight attacks
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = tr + dr, nc = tc + dc;
    if (onBoard(nr, nc)) {
      const p = board[sq(nr, nc)];
      if (enemy(p) && pieceType(p) === 2) return true;
    }
  }

  // King attacks
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = tr + dr, nc = tc + dc;
    if (onBoard(nr, nc)) {
      const p = board[sq(nr, nc)];
      if (enemy(p) && pieceType(p) === 6) return true;
    }
  }

  // Pawn attacks
  const pawnDir = byColor === 0 ? 1 : -1;
  for (const dc of [-1, 1]) {
    const nr = tr + pawnDir, nc = tc + dc;
    if (onBoard(nr, nc)) {
      const p = board[sq(nr, nc)];
      if (enemy(p) && pieceType(p) === 1) return true;
    }
  }

  // Sliding attacks (bishop/rook/queen)
  const diags = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const straights = [[-1,0],[1,0],[0,-1],[0,1]];

  for (const [dr, dc] of diags) {
    let nr = tr + dr, nc = tc + dc;
    while (onBoard(nr, nc)) {
      const p = board[sq(nr, nc)];
      if (p !== EMPTY) {
        if (enemy(p) && (pieceType(p) === 3 || pieceType(p) === 5)) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }

  for (const [dr, dc] of straights) {
    let nr = tr + dr, nc = tc + dc;
    while (onBoard(nr, nc)) {
      const p = board[sq(nr, nc)];
      if (p !== EMPTY) {
        if (enemy(p) && (pieceType(p) === 4 || pieceType(p) === 5)) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }

  return false;
}

function findKing(board, color) {
  const king = color === 0 ? W_KING : B_KING;
  for (let i = 0; i < 64; i++) {
    if (board[i] === king) return i;
  }
  return -1;
}

function isInCheck(board, color) {
  const kingSq = findKing(board, color);
  if (kingSq === -1) return true;
  return isAttacked(board, kingSq, 1 - color);
}

/* ---------- Game State ---------- */

function createGameState() {
  return {
    board: initialBoard(),
    turn: 0,                 // 0 = white, 1 = black
    castling: [true, true, true, true],  // white K, white Q, black K, black Q
    enPassant: -1,
    halfMoves: 0,
    fullMoves: 1,
    selected: -1,            // UI: selected square
    legalMoves: [],          // UI: legal moves for selected piece
    lastMove: null,          // { from, to }
    status: 'playing',       // 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw'
    moveSeq: 0,              // network sequence
    waitingForAck: false,
    promoSquare: -1,         // square awaiting promotion choice
    promoFrom: -1,
    moveHistory: [],
  };
}

/* ---------- Rendering ---------- */

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ = '#b58863';
const SELECT_COLOR = 'rgba(255, 255, 0, 0.4)';
const MOVE_DOT = 'rgba(0, 0, 0, 0.25)';
const LAST_MOVE = 'rgba(155, 199, 0, 0.4)';
const CHECK_COLOR = 'rgba(220, 50, 50, 0.5)';

function renderBoard(ctx, alpha) {
  const gs = ctx.state;
  const board = gs.board;
  const solo = !ctx.net;
  const flipped = !solo && ctx.localPlayerId === 1;

  clear('#2c2c2c');

  // Board squares
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const dr = flipped ? 7 - r : r;
      const dc = flipped ? 7 - c : c;
      const x = BOARD_X + dc * SQ;
      const y = BOARD_Y + dr * SQ;
      const isLight = (r + c) % 2 === 0;
      drawRect(x, y, SQ, SQ, isLight ? LIGHT_SQ : DARK_SQ);

      const s = sq(r, c);

      // Highlight last move
      if (gs.lastMove && (gs.lastMove.from === s || gs.lastMove.to === s)) {
        drawRect(x, y, SQ, SQ, LAST_MOVE);
      }

      // Highlight selected square
      if (gs.selected === s) {
        drawRect(x, y, SQ, SQ, SELECT_COLOR);
      }

      // Highlight king in check
      if ((gs.status === 'check' || gs.status === 'checkmate') && board[s] !== EMPTY &&
          pieceType(board[s]) === 6 && pieceColor(board[s]) === gs.turn) {
        drawRect(x, y, SQ, SQ, CHECK_COLOR);
      }
    }
  }

  // Legal move indicators
  for (const move of gs.legalMoves) {
    const { r, c } = rc(move.to);
    const dr = flipped ? 7 - r : r;
    const dc = flipped ? 7 - c : c;
    const x = BOARD_X + dc * SQ + SQ / 2;
    const y = BOARD_Y + dr * SQ + SQ / 2;
    if (board[move.to] !== EMPTY) {
      strokeRect(BOARD_X + dc * SQ + 2, BOARD_Y + dr * SQ + 2, SQ - 4, SQ - 4, MOVE_DOT, 3);
    } else {
      drawCircle(x, y, 5, MOVE_DOT);
    }
  }

  // Pieces
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const s = sq(r, c);
      const p = board[s];
      if (p === EMPTY) continue;
      const dr = flipped ? 7 - r : r;
      const dc = flipped ? 7 - c : c;
      const x = BOARD_X + dc * SQ + SQ / 2;
      const y = BOARD_Y + dr * SQ + SQ / 2;
      const ch = PIECE_CHARS[p];
      if (ch) {
        drawText(ch, x, y + 2, {
          size: SQ - 6,
          align: 'center',
          baseline: 'middle',
          color: isWhite(p) ? '#fff' : '#111',
          font: 'serif',
        });
      }
    }
  }

  // Rank/file labels
  for (let i = 0; i < 8; i++) {
    const file = flipped ? 'hgfedcba'[i] : 'abcdefgh'[i];
    const rank = flipped ? String(i + 1) : String(8 - i);
    drawText(file, BOARD_X + i * SQ + SQ / 2, BOARD_Y + 8 * SQ + 12, {
      size: 10, align: 'center', color: '#aaa',
    });
    drawText(rank, BOARD_X - 12, BOARD_Y + i * SQ + SQ / 2 + 3, {
      size: 10, align: 'center', color: '#aaa',
    });
  }

  // Status text
  const statusY = BOARD_Y - 14;
  if (gs.status === 'checkmate') {
    const winner = gs.turn === 0 ? 'Black' : 'White';
    drawText(`Checkmate! ${winner} wins`, VIRTUAL_W / 2, statusY, {
      size: 16, align: 'center', color: '#ff6', bold: true,
    });
  } else if (gs.status === 'stalemate' || gs.status === 'draw') {
    drawText('Draw!', VIRTUAL_W / 2, statusY, {
      size: 16, align: 'center', color: '#ff6', bold: true,
    });
  } else {
    const turnStr = gs.turn === 0 ? 'White' : 'Black';
    const youStr = solo ? '' : (gs.turn === ctx.localPlayerId ? ' (your turn)' : '');
    drawText(`${turnStr} to move${youStr}`, VIRTUAL_W / 2, statusY, {
      size: 12, align: 'center', color: '#ccc',
    });
  }

  // Promotion dialog
  if (gs.promoSquare >= 0) {
    renderPromoDialog(ctx);
  }

  // Move counter
  drawText(`Move ${gs.fullMoves}`, VIRTUAL_W / 2, BOARD_Y + 8 * SQ + 26, {
    size: 10, align: 'center', color: '#888',
  });
}

function renderPromoDialog(ctx) {
  const gs = ctx.state;
  const solo = !ctx.net;
  const promoColor = solo ? gs.turn : ctx.localPlayerId;
  const color = promoColor === 0 ? 0 : 0x80;
  const pieces = [
    { type: 'q', code: color | 5 },
    { type: 'r', code: color | 4 },
    { type: 'b', code: color | 3 },
    { type: 'n', code: color | 2 },
  ];

  drawRect(VIRTUAL_W / 2 - 85, VIRTUAL_H / 2 - 25, 170, 50, '#333');
  strokeRect(VIRTUAL_W / 2 - 85, VIRTUAL_H / 2 - 25, 170, 50, '#666', 2);

  for (let i = 0; i < 4; i++) {
    const x = VIRTUAL_W / 2 - 70 + i * 40;
    const y = VIRTUAL_H / 2;
    drawRoundRect(x - 15, y - 18, 30, 36, 4, '#555');
    drawText(PIECE_CHARS[pieces[i].code], x, y + 2, {
      size: 28, align: 'center', baseline: 'middle', font: 'serif',
      color: color === 0 ? '#fff' : '#111',
    });
  }
}

/* ---------- Click Handling ---------- */

function handleClick(ctx) {
  if (!consumeClick()) return;
  const gs = ctx.state;
  if (gs.status !== 'playing' && gs.status !== 'check') return;
  const solo = !ctx.net;
  if (!solo && gs.turn !== ctx.localPlayerId) return;
  if (gs.waitingForAck) return;

  const mouse = getMousePos();
  const flipped = !solo && ctx.localPlayerId === 1;

  // Promotion dialog click
  if (gs.promoSquare >= 0) {
    const promos = ['q', 'r', 'b', 'n'];
    for (let i = 0; i < 4; i++) {
      const x = VIRTUAL_W / 2 - 70 + i * 40;
      const y = VIRTUAL_H / 2;
      if (mouse.x >= x - 15 && mouse.x <= x + 15 && mouse.y >= y - 18 && mouse.y <= y + 18) {
        const move = { from: gs.promoFrom, to: gs.promoSquare, flag: 'promo', promo: promos[i] };
        executeAndSendMove(ctx, move);
        gs.promoSquare = -1;
        gs.promoFrom = -1;
        return;
      }
    }
    return;
  }

  // Board click
  const boardCol = Math.floor((mouse.x - BOARD_X) / SQ);
  const boardRow = Math.floor((mouse.y - BOARD_Y) / SQ);
  if (boardCol < 0 || boardCol > 7 || boardRow < 0 || boardRow > 7) {
    gs.selected = -1;
    gs.legalMoves = [];
    return;
  }

  const r = flipped ? 7 - boardRow : boardRow;
  const c = flipped ? 7 - boardCol : boardCol;
  const clickSq = sq(r, c);

  // Check if clicking a legal move destination
  const legalMove = gs.legalMoves.find(m => m.to === clickSq);
  if (legalMove) {
    // Handle promotion
    if (legalMove.flag === 'promo') {
      gs.promoSquare = clickSq;
      gs.promoFrom = legalMove.from;
      return;
    }
    executeAndSendMove(ctx, legalMove);
    return;
  }

  // Select a piece
  const p = gs.board[clickSq];
  if (p !== EMPTY && (solo ? pieceColor(p) === gs.turn : pieceColor(p) === ctx.localPlayerId)) {
    gs.selected = clickSq;
    gs.legalMoves = generateMoves(gs.board, gs.turn, gs).filter(m => m.from === clickSq);
  } else {
    gs.selected = -1;
    gs.legalMoves = [];
  }
}

function executeAndSendMove(ctx, move) {
  const gs = ctx.state;

  // Apply move locally
  const newState = applyMove(gs.board, move, gs);
  Object.assign(gs, newState);
  gs.lastMove = { from: move.from, to: move.to };
  gs.selected = -1;
  gs.legalMoves = [];
  gs.moveHistory.push({ from: move.from, to: move.to, flag: move.flag, promo: move.promo });

  // Check game status
  updateStatus(gs);

  // Send move over network
  if (ctx.net) {
    const payload = new Uint8Array(3);
    payload[0] = move.from;
    payload[1] = move.to;
    let flags = 0;
    if (move.flag === 'ep') flags = 1;
    else if (move.flag === 'castle-k') flags = 2;
    else if (move.flag === 'castle-q') flags = 3;
    else if (move.flag === 'double') flags = 4;
    else if (move.flag === 'promo') {
      flags = 5 + ['q', 'r', 'b', 'n'].indexOf(move.promo);
    }
    payload[2] = flags;
    ctx.net.sendReliable(encodeMove(gs.moveSeq++, payload));
  }
}

function updateStatus(gs) {
  const moves = generateMoves(gs.board, gs.turn, gs);
  const inCheck = isInCheck(gs.board, gs.turn);
  if (moves.length === 0) {
    gs.status = inCheck ? 'checkmate' : 'stalemate';
  } else if (inCheck) {
    gs.status = 'check';
  } else if (gs.halfMoves >= 100) {
    gs.status = 'draw';
  } else {
    gs.status = 'playing';
  }
}

/* ---------- Network Receive ---------- */

function onRemoteMove(ctx, buffer) {
  const msg = decodeMessage(buffer);
  if (msg.type === MSG.MOVE) {
    const gs = ctx.state;
    const from = msg.payload[0];
    const to = msg.payload[1];
    const flags = msg.payload[2];

    let move = { from, to };
    if (flags === 1) move.flag = 'ep';
    else if (flags === 2) move.flag = 'castle-k';
    else if (flags === 3) move.flag = 'castle-q';
    else if (flags === 4) move.flag = 'double';
    else if (flags >= 5 && flags <= 8) {
      move.flag = 'promo';
      move.promo = ['q', 'r', 'b', 'n'][flags - 5];
    }

    // Validate move
    const legalMoves = generateMoves(gs.board, gs.turn, gs);
    const legal = legalMoves.find(m =>
      m.from === move.from && m.to === move.to &&
      (m.flag || '') === (move.flag || '') && (m.promo || '') === (move.promo || '')
    );
    if (!legal) return;  // reject illegal move

    // Apply
    const newState = applyMove(gs.board, move, gs);
    Object.assign(gs, newState);
    gs.lastMove = { from, to };
    gs.moveHistory.push(move);
    updateStatus(gs);

    // Send ack
    if (ctx.net) {
      ctx.net.sendReliable(encodeMoveAck(msg.seq));
    }
  }
}

/* ---------- Game Registration ---------- */

registerGame({
  key: 'chess',
  name: 'Chess',
  description: 'Classic chess — all rules included',
  icon: '♟️',
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
    const data = new Uint8Array(64 + 10);
    data.set(gs.board, 0);
    data[64] = gs.turn;
    data[65] = (gs.castling[0] ? 1 : 0) | (gs.castling[1] ? 2 : 0) |
               (gs.castling[2] ? 4 : 0) | (gs.castling[3] ? 8 : 0);
    data[66] = gs.enPassant === -1 ? 255 : gs.enPassant;
    data[67] = gs.halfMoves;
    data[68] = gs.fullMoves & 0xFF;
    data[69] = (gs.fullMoves >> 8) & 0xFF;
    return data;
  },

  deserialize(ctx, data) {
    const gs = ctx.state;
    gs.board.set(data.subarray(0, 64));
    gs.turn = data[64];
    gs.castling = [!!(data[65] & 1), !!(data[65] & 2), !!(data[65] & 4), !!(data[65] & 8)];
    gs.enPassant = data[66] === 255 ? -1 : data[66];
    gs.halfMoves = data[67];
    gs.fullMoves = data[68] | (data[69] << 8);
  },

  cleanup(ctx) {
    ctx.state = null;
  },

  onNetMessage(ctx, buffer) {
    onRemoteMove(ctx, buffer);
  },
});

export default 'chess';
