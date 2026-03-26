/* ============================================================
   social.js — Social Profile / Feed Template

   A personal profile page backed by Google Sheets. Each sheet
   is a "wall" of posts. Shared sheets appear in a directory
   feed view, creating a private social network.
   ============================================================ */

import {
  el, cell, registerTemplate, buildAddRowForm,
  parseGroups, delegateEvent, editableCell,
  buildDirSyncBtn, WaymarkConnect,
} from './shared.js';

/* ---------- Constants ---------- */

const MOOD_MAP = {
  happy: '😊', sad: '😢', excited: '🎉', angry: '😤',
  love: '❤️', thinking: '🤔', laughing: '😂', cool: '😎',
  tired: '😴', surprised: '😮', grateful: '🙏', proud: '💪',
};

const CATEGORY_COLORS = {
  update: '#3b82f6', photo: '#8b5cf6', link: '#0d9488',
  thought: '#f59e0b', milestone: '#22c55e', question: '#ec4899',
};

/** First letter avatar with a stable color */
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 50%)`;
}

/** Relative time string */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

/* ---------- Live Chat (P2P via WaymarkConnect) ---------- */

let _activeConnect = null;
let _activeSheetId = null;
let _chatPanel = null;

/** Clean up active connection and chat panel. */
function destroyChat() {
  if (_activeConnect) { _activeConnect.destroy(); _activeConnect = null; }
  if (_chatPanel) { _chatPanel.remove(); _chatPanel = null; }
  _activeSheetId = null;
}

// Tear down when navigating away from the sheet
window.addEventListener('waymark:sheet-hidden', destroyChat);

/**
 * Build the floating chat panel and connect to peers.
 * @param {string} sheetId
 * @param {string} displayName
 * @param {Object} [signal] — Sheets signaling callbacks
 */
function openChat(sheetId, displayName, signal) {
  // Don't double-open for the same sheet
  if (_activeConnect && _activeSheetId === sheetId) {
    if (_chatPanel) _chatPanel.classList.remove('hidden');
    return;
  }
  destroyChat();
  _activeSheetId = sheetId;

  // --- Build panel DOM ---
  _chatPanel = el('div', { className: 'social-chat-panel' });

  const header = el('div', { className: 'social-chat-header' });
  const statusDot = el('span', { className: 'social-chat-status social-chat-status-listening' });
  const statusLabel = el('span', {}, ['Listening…']);
  const peerCount = el('span', { className: 'social-chat-peer-count' }, ['0 peers']);
  const minimizeBtn = el('button', {
    className: 'social-chat-minimize',
    title: 'Minimize',
    on: { click() { _chatPanel.classList.toggle('social-chat-minimized'); } },
  }, ['—']);
  const closeBtn = el('button', {
    className: 'social-chat-close',
    title: 'Disconnect',
    on: { click: destroyChat },
  }, ['✕']);
  header.append(el('span', { className: 'social-chat-title' }, ['📡 Live Chat']), statusDot, statusLabel, peerCount, minimizeBtn, closeBtn);

  const messages = el('div', { className: 'social-chat-messages' });

  // --- Call UI ---
  const callBar = el('div', { className: 'social-call-bar' });

  const callBtn = el('button', {
    className: 'social-call-btn',
    title: 'Start audio/video call',
  }, ['📞 Call']);
  const videoCallBtn = el('button', {
    className: 'social-call-btn social-call-btn-video',
    title: 'Start video call',
  }, ['📹 Video']);
  const hangupBtn = el('button', {
    className: 'social-call-btn social-call-btn-hangup hidden',
    title: 'End call',
  }, ['🔴 Hang Up']);
  const muteBtn = el('button', {
    className: 'social-call-btn social-call-btn-mute hidden',
    title: 'Toggle mute',
  }, ['🔇 Mute']);
  const camToggleBtn = el('button', {
    className: 'social-call-btn social-call-btn-cam hidden',
    title: 'Toggle camera',
  }, ['📷 Cam Off']);

  callBar.append(callBtn, videoCallBtn, hangupBtn, muteBtn, camToggleBtn);

  // Media container for video streams
  const mediaContainer = el('div', { className: 'social-media-container hidden' });
  const localVideo = el('video', { className: 'social-local-video', muted: true, autoplay: true, playsInline: true });
  const remoteVideo = el('video', { className: 'social-remote-video', autoplay: true, playsInline: true });
  const remoteAudio = el('audio', { className: 'social-remote-audio', autoplay: true });
  mediaContainer.append(remoteVideo, localVideo, remoteAudio);

  /** Enter the "in call" visual state */
  function enterCallUI(hasVideo) {
    callBtn.classList.add('hidden');
    videoCallBtn.classList.add('hidden');
    hangupBtn.classList.remove('hidden');
    muteBtn.classList.remove('hidden');
    if (hasVideo) {
      camToggleBtn.classList.remove('hidden');
      mediaContainer.classList.remove('hidden');
    }
    _chatPanel.classList.add('social-chat-in-call');
  }

  /** Leave the "in call" visual state */
  function exitCallUI() {
    callBtn.classList.remove('hidden');
    videoCallBtn.classList.remove('hidden');
    hangupBtn.classList.add('hidden');
    muteBtn.classList.add('hidden');
    camToggleBtn.classList.add('hidden');
    mediaContainer.classList.add('hidden');
    _chatPanel.classList.remove('social-chat-in-call');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    remoteAudio.srcObject = null;
    muteBtn.textContent = '🔇 Mute';
    camToggleBtn.textContent = '📷 Cam Off';
  }

  /** Start a call with the given constraints */
  async function startCall(constraints) {
    if (!_activeConnect) return;
    try {
      const stream = await _activeConnect.startCall(constraints);
      localVideo.srcObject = stream;
      enterCallUI(constraints.video);
    } catch (err) {
      appendMessage('System', `Could not start call: ${err.message}`, Date.now(), false);
    }
  }

  callBtn.addEventListener('click', () => startCall({ audio: true, video: false }));
  videoCallBtn.addEventListener('click', () => startCall({ audio: true, video: true }));

  hangupBtn.addEventListener('click', () => {
    if (_activeConnect) _activeConnect.endCall();
    exitCallUI();
  });

  muteBtn.addEventListener('click', () => {
    if (!_activeConnect?.localStream) return;
    const audioTrack = _activeConnect.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      muteBtn.textContent = audioTrack.enabled ? '🔇 Mute' : '🔊 Unmute';
    }
  });

  camToggleBtn.addEventListener('click', () => {
    if (!_activeConnect?.localStream) return;
    const videoTrack = _activeConnect.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      camToggleBtn.textContent = videoTrack.enabled ? '📷 Cam Off' : '📷 Cam On';
    }
  });

  // --- Input bar ---
  const inputBar = el('div', { className: 'social-chat-input-bar' });
  const input = el('input', {
    className: 'social-chat-input',
    type: 'text',
    placeholder: 'Type a message…',
    autocomplete: 'off',
  });
  const sendBtn = el('button', { className: 'social-chat-send' }, ['Send']);
  inputBar.append(input, sendBtn);

  _chatPanel.append(header, mediaContainer, messages, callBar, inputBar);
  document.body.append(_chatPanel);

  // --- Render a chat message ---
  function appendMessage(name, text, ts, isSelf) {
    const bubble = el('div', { className: `social-chat-bubble ${isSelf ? 'social-chat-self' : 'social-chat-peer'}` });
    const initial = (name || '?')[0].toUpperCase();
    bubble.append(
      el('div', { className: 'social-avatar social-avatar-sm', style: `background: ${avatarColor(name || 'Anonymous')}` }, [initial]),
      el('div', { className: 'social-chat-bubble-body' }, [
        el('span', { className: 'social-chat-bubble-name' }, [name]),
        el('span', { className: 'social-chat-bubble-text' }, [text]),
        el('span', { className: 'social-chat-bubble-time' }, [timeAgo(new Date(ts).toISOString())]),
      ]),
    );
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  // --- Send handler ---
  function sendMessage() {
    const text = input.value.trim();
    if (!text || !_activeConnect) return;
    const msg = _activeConnect.send(text);
    appendMessage(msg.name, msg.text, msg.ts, true);
    input.value = '';
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });

  // --- Create connection ---
  _activeConnect = new WaymarkConnect(sheetId, {
    displayName,
    signal,
    onMessage(msg) {
      appendMessage(msg.name, msg.text, msg.ts, false);
    },
    onPeersChanged(peers) {
      peerCount.textContent = `${peers.size} peer${peers.size !== 1 ? 's' : ''}`;
    },
    onStatusChanged(status) {
      statusDot.className = `social-chat-status social-chat-status-${status}`;
      statusLabel.textContent = status === 'connected' ? 'Connected' : status === 'listening' ? 'Listening…' : 'Disconnected';
    },
    onRemoteStream(stream) {
      // Determine if it has video tracks
      if (stream.getVideoTracks().length > 0) {
        remoteVideo.srcObject = stream;
        mediaContainer.classList.remove('hidden');
      } else {
        remoteAudio.srcObject = stream;
      }
      // Enter call UI if not already in call
      if (!_activeConnect?.inCall) enterCallUI(stream.getVideoTracks().length > 0);
    },
    onCallEnded() {
      exitCallUI();
      appendMessage('System', 'Peer ended the call.', Date.now(), false);
    },
  });
  _activeConnect.start();
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Social Feed',
  icon: '💬',
  color: '#6366f1',
  priority: 19,
  itemNoun: 'Post',
  defaultHeaders: ['Post', 'Author', 'Date', 'Category', 'Mood', 'Link', 'Comment'],

  detect(lower) {
    return lower.some(h => /^(post|message|status|update|wall|feed|content)/.test(h))
      && lower.some(h => /^(author|poster|user|posted.?by|from|name|who)/.test(h))
      && lower.some(h => /^(date|time|posted|timestamp|when|created)/.test(h));
  },

  columns(lower) {
    const cols = {
      text: -1, author: -1, date: -1, category: -1,
      mood: -1, link: -1, comment: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.text     = lower.findIndex(h => /^(post|message|status|update|content|wall|feed)/.test(h));
    cols.author   = lower.findIndex((h, i) => !used().includes(i) && /^(author|poster|user|posted.?by|from|name|who)/.test(h));
    cols.date     = lower.findIndex((h, i) => !used().includes(i) && /^(date|time|posted|timestamp|when|created)/.test(h));
    cols.category = lower.findIndex((h, i) => !used().includes(i) && /^(category|type|kind|tag|topic)/.test(h));
    cols.mood     = lower.findIndex((h, i) => !used().includes(i) && /^(mood|feeling|emoji|vibe|status.?mood)/.test(h));
    cols.link     = lower.findIndex((h, i) => !used().includes(i) && /^(link|url|href|website|share)/.test(h));
    cols.comment  = lower.findIndex((h, i) => !used().includes(i) && /^(comment|reply|response|note|reaction)/.test(h));

    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Post',      colIndex: cols.text,     type: 'textarea', placeholder: "What's on your mind?", required: true },
      { role: 'author',   label: 'Author',     colIndex: cols.author,   type: 'text',     placeholder: 'Your name' },
      { role: 'date',     label: 'Date',        colIndex: cols.date,     type: 'date' },
      { role: 'category', label: 'Category',    colIndex: cols.category, type: 'select',   options: ['update', 'photo', 'link', 'thought', 'milestone', 'question'] },
      { role: 'mood',     label: 'Mood',        colIndex: cols.mood,     type: 'select',   options: ['', ...Object.keys(MOOD_MAP)] },
      { role: 'link',     label: 'Link',        colIndex: cols.link,     type: 'text',     placeholder: 'https://...' },
    ];
  },

  /* ---------- Directory View (feed of shared profiles) ---------- */

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'social-directory' });

    const titleBar = el('div', { className: 'social-dir-title-bar' });
    titleBar.append(
      el('span', { className: 'social-dir-icon' }, ['💬']),
      el('span', { className: 'social-dir-title' }, ['Social Feed']),
      el('span', { className: 'social-dir-count' }, [
        `${sheets.length} profile${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    );
    wrapper.append(titleBar);

    // Collect all posts across all sheets for the combined feed
    const allPosts = [];
    for (const sheet of sheets) {
      const cols = sheet.cols;
      for (const row of (sheet.rows || [])) {
        const postText = cols.text >= 0 ? (row[cols.text] || '') : '';
        if (!postText) continue;
        allPosts.push({
          sheetId: sheet.id,
          sheetName: sheet.name,
          text: postText,
          author: cols.author >= 0 ? (row[cols.author] || sheet.name) : sheet.name,
          date: cols.date >= 0 ? (row[cols.date] || '') : '',
          category: cols.category >= 0 ? (row[cols.category] || '') : '',
          mood: cols.mood >= 0 ? (row[cols.mood] || '') : '',
          link: cols.link >= 0 ? (row[cols.link] || '') : '',
        });
      }
    }

    // Sort by date descending
    allPosts.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const feed = el('div', { className: 'social-feed' });

    const PAGE_SIZE = 20;
    let shown = 0;

    function renderBatch() {
      const batch = allPosts.slice(shown, shown + PAGE_SIZE);
      for (const post of batch) {
        feed.append(buildFeedCard(post));
      }
      shown += batch.length;

      // Remove old "more" button
      const oldMore = feed.querySelector('.social-feed-more');
      if (oldMore) oldMore.remove();

      if (shown < allPosts.length) {
        const moreBtn = el('button', { className: 'social-feed-more' }, [
          `Show ${Math.min(allPosts.length - shown, PAGE_SIZE)} more posts`,
        ]);
        moreBtn.addEventListener('click', renderBatch);
        feed.append(moreBtn);
      }
    }

    function buildFeedCard(post) {
      const card = el('div', {
        className: 'social-post',
        dataset: { entryId: post.sheetId, entryName: post.sheetName },
      });

      // Header: avatar + author + date + source
      const header = el('div', { className: 'social-post-header' });
      const initial = (post.author || '?')[0].toUpperCase();
      header.append(
        el('div', {
          className: 'social-avatar',
          style: `background: ${avatarColor(post.author)}`,
        }, [initial]),
        el('div', { className: 'social-post-meta' }, [
          el('span', { className: 'social-post-author' }, [post.author]),
          el('span', { className: 'social-post-time' }, [timeAgo(post.date)]),
        ]),
      );

      if (post.category) {
        const color = CATEGORY_COLORS[post.category.toLowerCase()] || '#6b7280';
        header.append(el('span', {
          className: 'social-post-category',
          style: `background: ${color}`,
        }, [post.category]));
      }

      card.append(header);

      // Body
      card.append(el('div', { className: 'social-post-body' }, [post.text]));

      // Mood
      if (post.mood) {
        const emoji = MOOD_MAP[post.mood.toLowerCase()] || post.mood;
        card.append(el('div', { className: 'social-post-mood' }, [
          `Feeling ${post.mood} ${emoji}`,
        ]));
      }

      // Link
      if (post.link) {
        const a = el('a', {
          className: 'social-post-link',
          href: post.link,
          target: '_blank',
          rel: 'noopener',
        }, [`🔗 ${post.link}`]);
        card.append(a);
      }

      // Source badge
      card.append(el('div', { className: 'social-post-source' }, [
        `from `,
        el('span', { className: 'social-post-source-name' }, [post.sheetName]),
      ]));

      return card;
    }

    // Delegated click: click post card → navigate to that sheet
    delegateEvent(feed, 'click', '.social-post', (_e, card) => {
      const a = _e.target.closest('a');
      if (a) return; // Don't navigate when clicking links
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    renderBatch();
    wrapper.append(feed);

    if (allPosts.length === 0) {
      wrapper.append(el('p', { className: 'social-empty' }, ['No posts yet. Create a social sheet and start posting!']));
    }

    container.append(wrapper);
  },

  /* ---------- Main Render ---------- */

  render(container, rows, cols, template) {
    const groups = parseGroups(rows, cols.text, {
      initGroup: () => ({ comments: [] }),
      classifyChild: (child, parent) => {
        parent.comments.push(child);
      },
    });

    // Collect unique authors for add-row combo
    const allAuthors = cols.author >= 0
      ? [...new Set(groups.map(g => cell(g.row, cols.author)).filter(Boolean))].sort()
      : [];

    container.innerHTML = '';

    /* ---- Profile header ---- */
    const profileHeader = el('div', { className: 'social-profile-header' });

    // Determine dominant author (page owner)
    const authorCounts = {};
    for (const g of groups) {
      const a = cols.author >= 0 ? cell(g.row, cols.author) : '';
      if (a) authorCounts[a] = (authorCounts[a] || 0) + 1;
    }
    const pageOwner = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'My Feed';

    const ownerInitial = pageOwner[0].toUpperCase();
    const connectBtn = el('button', {
      className: 'social-connect-btn',
      title: 'Start live peer-to-peer chat with anyone viewing this sheet',
      on: { click() { openChat(template._rtcSheetId, template._rtcUserName, template._rtcSignal); } },
    }, ['📡 Connect']);

    profileHeader.append(
      el('div', {
        className: 'social-avatar social-avatar-lg',
        style: `background: ${avatarColor(pageOwner)}`,
      }, [ownerInitial]),
      el('div', { className: 'social-profile-info' }, [
        el('h3', { className: 'social-profile-name' }, [pageOwner]),
        el('span', { className: 'social-profile-stats' }, [
          `${groups.length} post${groups.length !== 1 ? 's' : ''} · ${allAuthors.length} contributor${allAuthors.length !== 1 ? 's' : ''}`,
        ]),
      ]),
      connectBtn,
    );
    container.append(profileHeader);

    /* ---- Add row form ---- */
    if (typeof template._onAddRow === 'function' && typeof template.addRowFields === 'function') {
      const addForm = buildAddRowForm(template, cols, template._totalColumns || 0, template._onAddRow, {
        dynamicOptions: {},
      });
      container.append(addForm);
    }

    /* ---- Posts feed ---- */
    const feed = el('div', { className: 'social-feed' });

    // Sort groups by date descending
    const sorted = [...groups].sort((a, b) => {
      const da = cols.date >= 0 ? cell(a.row, cols.date) : '';
      const db = cols.date >= 0 ? cell(b.row, cols.date) : '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    for (const group of sorted) {
      const postText = cell(group.row, cols.text);
      const author   = cols.author >= 0 ? cell(group.row, cols.author) : '';
      const date     = cols.date >= 0 ? cell(group.row, cols.date) : '';
      const category = cols.category >= 0 ? cell(group.row, cols.category) : '';
      const mood     = cols.mood >= 0 ? cell(group.row, cols.mood) : '';
      const link     = cols.link >= 0 ? cell(group.row, cols.link) : '';

      const post = el('div', {
        className: 'social-post',
        dataset: { rowIdx: String(group.idx + 1) },
      });

      /* ---- Post header ---- */
      const header = el('div', { className: 'social-post-header' });
      const initial = (author || '?')[0].toUpperCase();
      header.append(
        el('div', {
          className: 'social-avatar',
          style: `background: ${avatarColor(author || 'Anonymous')}`,
        }, [initial]),
        el('div', { className: 'social-post-meta' }, [
          cols.author >= 0
            ? editableCell('span', { className: 'social-post-author' }, author, group.idx + 1, cols.author)
            : el('span', { className: 'social-post-author' }, [author || 'Anonymous']),
          el('span', { className: 'social-post-time' }, [timeAgo(date)]),
        ]),
      );

      if (category) {
        const color = CATEGORY_COLORS[category.toLowerCase()] || '#6b7280';
        header.append(el('span', {
          className: 'social-post-category',
          style: `background: ${color}`,
        }, [category]));
      }

      post.append(header);

      /* ---- Post body (editable) ---- */
      post.append(editableCell('div', { className: 'social-post-body' }, postText, group.idx + 1, cols.text, {
        multiline: true,
      }));

      /* ---- Mood ---- */
      if (mood) {
        const emoji = MOOD_MAP[mood.toLowerCase()] || mood;
        post.append(el('div', { className: 'social-post-mood' }, [
          `Feeling ${mood} ${emoji}`,
        ]));
      }

      /* ---- Link ---- */
      if (link) {
        const a = el('a', {
          className: 'social-post-link',
          href: link,
          target: '_blank',
          rel: 'noopener',
        }, [`🔗 ${link}`]);
        post.append(a);
      }

      /* ---- Comments ---- */
      if (group.comments && group.comments.length > 0) {
        const commentsSection = el('div', { className: 'social-comments' });
        commentsSection.append(el('div', { className: 'social-comments-label' }, [
          `💬 ${group.comments.length} comment${group.comments.length !== 1 ? 's' : ''}`,
        ]));

        for (const cmt of group.comments) {
          const cmtAuthor = cols.author >= 0 ? cell(cmt.row, cols.author) : '';
          const cmtText   = cell(cmt.row, cols.text) || (cols.comment >= 0 ? cell(cmt.row, cols.comment) : '');
          const cmtDate   = cols.date >= 0 ? cell(cmt.row, cols.date) : '';

          const cmtEl = el('div', { className: 'social-comment' });
          const cmtInitial = (cmtAuthor || '?')[0].toUpperCase();
          cmtEl.append(
            el('div', {
              className: 'social-avatar social-avatar-sm',
              style: `background: ${avatarColor(cmtAuthor || 'Anonymous')}`,
            }, [cmtInitial]),
            el('div', { className: 'social-comment-content' }, [
              el('span', { className: 'social-comment-author' }, [cmtAuthor || 'Anonymous']),
              el('span', { className: 'social-comment-text' }, [cmtText]),
              cmtDate ? el('span', { className: 'social-comment-time' }, [timeAgo(cmtDate)]) : null,
            ].filter(Boolean)),
          );
          commentsSection.append(cmtEl);
        }
        post.append(commentsSection);
      }

      /* ---- Post footer (date + category) ---- */
      const footer = el('div', { className: 'social-post-footer' });
      if (date) {
        footer.append(el('span', { className: 'social-post-date' }, [
          new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ]));
      }
      post.append(footer);

      feed.append(post);
    }

    container.append(feed);

    if (groups.length === 0) {
      feed.append(el('p', { className: 'social-empty' }, ['No posts yet. Add your first post above!']));
    }
  },
};

registerTemplate('social', definition);
export default definition;
