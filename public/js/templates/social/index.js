/* ============================================================
   social/index.js — Template definition for Social template
   ============================================================ */

import {
  el, cell, registerTemplate, buildAddRowForm,
  parseGroups, delegateEvent, editableCell, buildDirSyncBtn,
} from '../shared.js';
import { MOOD_MAP, CATEGORY_COLORS, avatarColor, timeAgo, SIG_COL } from './helpers.js';
import { openChat, destroyChat } from './chat.js';

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Social Feed',
  icon: '💬',
  color: '#6366f1',
  priority: 19,
  itemNoun: 'Post',
  defaultHeaders: ['Post', 'Author', 'Date', 'Category', 'Mood', 'Link', 'Comment', 'Likes', 'Image'],

  migrations: [
    { role: 'likes', header: 'Likes', description: 'Engagement count per post' },
    { role: 'image', header: 'Image', description: 'Image URL for photo posts' },
  ],

  detect(lower) {
    return lower.some(h => /^(post|message|status|update|wall|feed|content)/.test(h))
      && lower.some(h => /^(author|poster|user|posted.?by|from|name|who)/.test(h))
      && lower.some(h => /^(date|time|posted|timestamp|when|created)/.test(h));
  },

  columns(lower) {
    const cols = {
      text: -1, author: -1, date: -1, category: -1,
      mood: -1, link: -1, comment: -1, likes: -1, image: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.text     = lower.findIndex(h => /^(post|message|status|update|content|wall|feed)/.test(h));
    cols.author   = lower.findIndex((h, i) => !used().includes(i) && /^(author|poster|user|posted.?by|from|name|who)/.test(h));
    cols.date     = lower.findIndex((h, i) => !used().includes(i) && /^(date|time|posted|timestamp|when|created)/.test(h));
    cols.category = lower.findIndex((h, i) => !used().includes(i) && /^(category|type|kind|tag|topic)/.test(h));
    cols.mood     = lower.findIndex((h, i) => !used().includes(i) && /^(mood|feeling|emoji|vibe|status.?mood)/.test(h));
    cols.link     = lower.findIndex((h, i) => !used().includes(i) && /^(link|url|href|website|share)/.test(h));
    cols.comment  = lower.findIndex((h, i) => !used().includes(i) && /^(comment|reply|response|note|reaction)/.test(h));
    cols.likes    = lower.findIndex((h, i) => !used().includes(i) && /^(likes?|upvotes?|reactions?|engagement|hearts?)/.test(h));
    cols.image    = lower.findIndex((h, i) => !used().includes(i) && /^(image|photo|picture|img|media|attachment)/.test(h));

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
      { role: 'image',    label: 'Image URL',   colIndex: cols.image,    type: 'text',     placeholder: 'https://...' },
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
        // Chat rows belong in the chat panel, not the post feed
        const cat = cols.category >= 0 ? (row[cols.category] || '') : '';
        if (cat.toLowerCase() === 'chat') continue;
        allPosts.push({
          sheetId: sheet.id,
          sheetName: sheet.name,
          text: postText,
          author: cols.author >= 0 ? (row[cols.author] || sheet.name) : sheet.name,
          date: cols.date >= 0 ? (row[cols.date] || '') : '',
          category: cols.category >= 0 ? (row[cols.category] || '') : '',
          mood: cols.mood >= 0 ? (row[cols.mood] || '') : '',
          link: cols.link >= 0 ? (row[cols.link] || '') : '',
          likes: cols.likes >= 0 ? (row[cols.likes] || '') : '',
          image: cols.image >= 0 ? (row[cols.image] || '') : '',
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

      // Image
      if (post.image) {
        card.append(el('img', {
          className: 'social-post-image',
          src: post.image,
          alt: 'Post image',
          loading: 'lazy',
        }));
      }

      // Likes
      if (post.likes) {
        card.append(el('div', { className: 'social-post-likes' }, [
          `❤️ ${post.likes}`,
        ]));
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
      // Chat rows belong in the chat panel, not the post feed
      if (category.toLowerCase() === 'chat') continue;
      const mood     = cols.mood >= 0 ? cell(group.row, cols.mood) : '';
      const link     = cols.link >= 0 ? cell(group.row, cols.link) : '';
      const likes    = cols.likes >= 0 ? cell(group.row, cols.likes) : '';
      const image    = cols.image >= 0 ? cell(group.row, cols.image) : '';

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

      /* ---- Image ---- */
      if (image) {
        post.append(el('img', {
          className: 'social-post-image',
          src: image,
          alt: 'Post image',
          loading: 'lazy',
        }));
      }

      /* ---- Likes ---- */
      if (likes) {
        post.append(el('div', { className: 'social-post-likes' }, [
          `❤️ ${likes}`,
        ]));
      }

      /* ---- Comments ---- */
      if (group.comments && group.comments.length > 0) {
        const commentsSection = el('div', { className: 'social-comments' });
        commentsSection.append(el('div', { className: 'social-comments-label' }, [
          `💬 ${group.comments.length} comment${group.comments.length !== 1 ? 's' : ''}`,
        ]));

        for (const cmt of group.comments) {
          const cmtAuthor = cols.author >= 0 ? cell(cmt.row, cols.author) : '';
          // Comment rows have empty text column (that's how parseGroups classifies them).
          // Try dedicated comment column first, then scan all columns for any content.
          let cmtText = '';
          if (cols.comment >= 0) {
            cmtText = cell(cmt.row, cols.comment);
          }
          if (!cmtText) {
            // Fallback: find the first non-empty cell that isn't the author or date
            // Skip SIG_COL (WebRTC signaling) so handshake JSON never leaks into the UX
            const skip = new Set([cols.text, cols.author, cols.date, cols.category, cols.mood, cols.link, cols.likes, cols.image, SIG_COL].filter(c => c >= 0));
            for (let ci = 0; ci < cmt.row.length; ci++) {
              if (!skip.has(ci) && cell(cmt.row, ci)) { cmtText = cell(cmt.row, ci); break; }
            }
          }
          // Skip rows with no visible content (e.g. signaling-only rows)
          if (!cmtText && !cmtAuthor) continue;
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
