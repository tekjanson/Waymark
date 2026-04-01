/* ============================================================
   templates/marketing.js — Content Workbench: draft social posts,
   track what resonates, find your voice, grow your audience
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, delegateEvent, cycleStatus, buildDirSyncBtn } from './shared.js';

/* ---------- Helpers ---------- */

/** Parse a numeric string */
function parseNum(raw) {
  return parseInt((raw || '0').replace(/[^-\d]/g, ''), 10) || 0;
}

/** Compact number display */
function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Calculate engagement rate: (likes + shares + comments) / views */
function engRate(likes, shares, comments, views) {
  if (!views) return null;
  const total = likes + shares + comments;
  return ((total / views) * 100).toFixed(1);
}

/** Platform emoji + color mapping */
const PLATFORM_META = {
  twitter:  { emoji: '𝕏', color: '#000000', bg: '#f0f0f0', label: 'X / Twitter' },
  reddit:   { emoji: '🤖', color: '#ff4500', bg: '#fff4f0', label: 'Reddit' },
  linkedin: { emoji: '💼', color: '#0a66c2', bg: '#eef3ff', label: 'LinkedIn' },
  youtube:  { emoji: '▶️', color: '#ff0000', bg: '#fff0f0', label: 'YouTube' },
  blog:     { emoji: '✍️', color: '#059669', bg: '#f0fdf4', label: 'Blog' },
  hn:       { emoji: '🟧', color: '#ff6600', bg: '#fff8f0', label: 'Hacker News' },
  ph:       { emoji: '🚀', color: '#da552f', bg: '#fdf3f0', label: 'Product Hunt' },
  email:    { emoji: '📧', color: '#7c3aed', bg: '#f5f3ff', label: 'Email' },
  other:    { emoji: '🌐', color: '#64748b', bg: '#f1f5f9', label: 'Other' },
};

/** Match platform string to key */
function platformKey(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (/twitter|tweet|x\.com/.test(v)) return 'twitter';
  if (/reddit/.test(v)) return 'reddit';
  if (/linkedin/.test(v)) return 'linkedin';
  if (/youtube|yt/.test(v)) return 'youtube';
  if (/blog|post|article|medium|substack|dev\.to/.test(v)) return 'blog';
  if (/hacker.?news|hn/.test(v)) return 'hn';
  if (/product.?hunt|ph/.test(v)) return 'ph';
  if (/email|newsletter|mail/.test(v)) return 'email';
  return 'other';
}

/** Word count */
function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Truncate text for preview */
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

const STATUSES = ['Idea', 'Drafting', 'Ready', 'Posted', 'Analyzing'];

const definition = {
  name: 'Content Workbench',
  icon: '📣',
  color: '#e11d48',
  priority: 24,
  itemNoun: 'Post',
  defaultHeaders: ['Post', 'Platform', 'Status', 'Topic', 'Posted Date', 'Likes', 'Shares', 'Comments', 'Views', 'Link', 'Takeaway'],

  detect(lower) {
    /* Needs post/content column + platform column + at least one engagement metric */
    const hasPost = lower.some(h => /^(post|content|draft|copy|caption|message|tweet|text)/.test(h));
    const hasPlatform = lower.some(h => /^(platform|channel|network|where|site|medium)/.test(h));
    const hasEngagement = lower.some(h => /^(like|share|repost|comment|reply|view|impression|click|engagement|reach)/.test(h));
    const hasTakeaway = lower.some(h => /^(takeaway|lesson|learning|insight|worked|what.?worked|voice|tone)/.test(h));
    return hasPost && hasPlatform && (hasEngagement || hasTakeaway);
  },

  columns(lower) {
    const cols = { post: -1, platform: -1, status: -1, topic: -1, date: -1,
                   likes: -1, shares: -1, comments: -1, views: -1, link: -1, takeaway: -1 };
    cols.post     = lower.findIndex(h => /^(post|content|draft|copy|caption|message|tweet|text)/.test(h));
    if (cols.post === -1) cols.post = 0;
    cols.platform = lower.findIndex((h, i) => i !== cols.post && /^(platform|channel|network|where|site|medium)/.test(h));
    cols.status   = lower.findIndex((h, i) => i !== cols.post && i !== cols.platform && /^(status|stage|state|progress)/.test(h));
    cols.topic    = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(topic|category|theme|tag|about|angle|hook)/.test(h));
    cols.date     = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(date|posted|published|when|scheduled)/.test(h));
    cols.likes    = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(like|heart|upvote|reaction|fav)/.test(h));
    cols.shares   = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(share|repost|retweet|forward|boost)/.test(h));
    cols.comments = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(comment|reply|response|discuss)/.test(h));
    cols.views    = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(view|impression|reach|seen|read)/.test(h));
    cols.link     = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(link|url|href|address)/.test(h));
    cols.takeaway = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(takeaway|lesson|learning|insight|worked|what.?worked|voice|tone|note)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'post',     label: 'Post',      colIndex: cols.post,     type: 'text', placeholder: 'Write your post content...', required: true },
      { role: 'platform', label: 'Platform',   colIndex: cols.platform, type: 'select', options: ['Twitter', 'Reddit', 'LinkedIn', 'YouTube', 'Blog', 'HN', 'Email', 'Other'], defaultValue: 'Twitter' },
      { role: 'status',   label: 'Status',     colIndex: cols.status,   type: 'select', options: STATUSES, defaultValue: 'Idea' },
      { role: 'topic',    label: 'Topic',      colIndex: cols.topic,    type: 'text', placeholder: 'What is this about?' },
      { role: 'link',     label: 'Link',       colIndex: cols.link,     type: 'text', placeholder: 'https://...' },
      { role: 'takeaway', label: 'Takeaway',   colIndex: cols.takeaway, type: 'text', placeholder: 'What did you learn?' },
    ];
  },

  dealStages: STATUSES,

  stageClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(analyz|review|measur|check|track)/.test(v)) return 'analyzing';
    if (/^(post|publish|sent|live|shared|up)/.test(v)) return 'posted';
    if (/^(ready|final|approved|queued|schedul)/.test(v)) return 'ready';
    if (/^(draft|writing|edit|work)/.test(v)) return 'drafting';
    return 'idea';
  },

  render(container, rows, cols, template) {
    /* ---------- Aggregate stats ---------- */
    let totalLikes = 0, totalShares = 0, totalComments = 0, totalViews = 0;
    let postedCount = 0;
    const platformStats = {};
    const topicStats = {};
    const topPosts = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const likes    = parseNum(cell(row, cols.likes));
      const shares   = parseNum(cell(row, cols.shares));
      const comments = parseNum(cell(row, cols.comments));
      const views    = parseNum(cell(row, cols.views));
      const engagement = likes + shares + comments;
      const plat     = platformKey(cell(row, cols.platform));
      const topic    = (cell(row, cols.topic) || '').trim();
      const status   = template.stageClass(cell(row, cols.status));

      totalLikes    += likes;
      totalShares   += shares;
      totalComments += comments;
      totalViews    += views;

      if (status === 'posted' || status === 'analyzing') postedCount++;

      /* Platform breakdown */
      if (!platformStats[plat]) platformStats[plat] = { posts: 0, likes: 0, shares: 0, comments: 0, views: 0, engagement: 0, posted: 0 };
      platformStats[plat].posts++;
      platformStats[plat].likes    += likes;
      platformStats[plat].shares   += shares;
      platformStats[plat].comments += comments;
      platformStats[plat].views    += views;
      platformStats[plat].engagement += engagement;
      if (status === 'posted' || status === 'analyzing') platformStats[plat].posted++;

      /* Topic breakdown */
      if (topic) {
        if (!topicStats[topic]) topicStats[topic] = { posts: 0, engagement: 0, views: 0 };
        topicStats[topic].posts++;
        topicStats[topic].engagement += engagement;
        topicStats[topic].views += views;
      }

      /* Track all posted/analyzing for top posts */
      if ((status === 'posted' || status === 'analyzing') && engagement > 0) {
        topPosts.push({ idx: i, engagement, likes, shares, comments, views });
      }
    }

    topPosts.sort((a, b) => b.engagement - a.engagement);

    /* ---------- Scoreboard ---------- */
    const totalEng = totalLikes + totalShares + totalComments;
    const avgEng = postedCount > 0 ? Math.round(totalEng / postedCount) : 0;
    const overallEngRate = totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(1) : '—';

    const scoreboard = el('div', { className: 'marketing-scoreboard' }, [
      el('div', { className: 'marketing-score-item' }, [
        el('span', { className: 'marketing-score-num' }, [String(rows.length)]),
        el('span', { className: 'marketing-score-label' }, ['Total Posts']),
      ]),
      el('div', { className: 'marketing-score-item' }, [
        el('span', { className: 'marketing-score-num' }, [String(postedCount)]),
        el('span', { className: 'marketing-score-label' }, ['Published']),
      ]),
      el('div', { className: 'marketing-score-item' }, [
        el('span', { className: 'marketing-score-num' }, [fmtNum(totalEng)]),
        el('span', { className: 'marketing-score-label' }, ['Engagements']),
      ]),
      el('div', { className: 'marketing-score-item' }, [
        el('span', { className: 'marketing-score-num' }, [String(avgEng)]),
        el('span', { className: 'marketing-score-label' }, ['Avg / Post']),
      ]),
      el('div', { className: 'marketing-score-item' }, [
        el('span', { className: 'marketing-score-num' }, [overallEngRate === '—' ? '—' : `${overallEngRate}%`]),
        el('span', { className: 'marketing-score-label' }, ['Eng. Rate']),
      ]),
    ]);
    container.append(scoreboard);

    /* ---------- What's Working section ---------- */
    if (topPosts.length >= 2) {
      const topN = topPosts.slice(0, 3);
      const whatsWorking = el('div', { className: 'marketing-whats-working' }, [
        el('div', { className: 'marketing-section-title' }, ['🔥 What\'s Working']),
        el('div', { className: 'marketing-top-posts' },
          topN.map((tp, rank) => {
            const row = rows[tp.idx];
            const postText = cell(row, cols.post) || row[0] || '';
            const plat = platformKey(cell(row, cols.platform));
            const meta = PLATFORM_META[plat];
            const takeaway = cell(row, cols.takeaway);
            return el('div', { className: 'marketing-top-post' }, [
              el('span', { className: 'marketing-top-rank' }, [`#${rank + 1}`]),
              el('span', { className: 'marketing-top-platform', style: `color: ${meta.color}` }, [meta.emoji]),
              el('div', { className: 'marketing-top-content' }, [
                el('div', { className: 'marketing-top-text' }, [truncate(postText, 120)]),
                el('div', { className: 'marketing-top-stats' }, [
                  el('span', {}, [`❤️ ${fmtNum(tp.likes)}`]),
                  el('span', {}, [`🔄 ${fmtNum(tp.shares)}`]),
                  el('span', {}, [`💬 ${fmtNum(tp.comments)}`]),
                  tp.views ? el('span', {}, [`👁 ${fmtNum(tp.views)}`]) : null,
                ]),
                takeaway ? el('div', { className: 'marketing-top-takeaway' }, [`💡 ${takeaway}`]) : null,
              ]),
            ]);
          })
        ),
      ]);
      container.append(whatsWorking);
    }

    /* ---------- Platform breakdown ---------- */
    const platKeys = Object.keys(platformStats).sort((a, b) => platformStats[b].engagement - platformStats[a].engagement);
    if (platKeys.length > 0) {
      const bestPlat = platKeys[0];
      const bestMeta = PLATFORM_META[bestPlat];
      const platSection = el('div', { className: 'marketing-platforms' }, [
        el('div', { className: 'marketing-section-title' }, ['📊 Platform Breakdown']),
        el('div', { className: 'marketing-platform-grid' },
          platKeys.map(pk => {
            const d = platformStats[pk];
            const meta = PLATFORM_META[pk];
            const avgEngPlat = d.posted > 0 ? Math.round(d.engagement / d.posted) : 0;
            const isBest = pk === bestPlat && d.engagement > 0;
            return el('div', { className: `marketing-plat-card${isBest ? ' marketing-plat-best' : ''}` }, [
              el('div', { className: 'marketing-plat-header' }, [
                el('span', { className: 'marketing-plat-emoji', style: `color: ${meta.color}` }, [meta.emoji]),
                el('span', { className: 'marketing-plat-name' }, [meta.label]),
                isBest ? el('span', { className: 'marketing-plat-badge' }, ['⭐ Best']) : null,
              ]),
              el('div', { className: 'marketing-plat-stats' }, [
                el('span', {}, [`${d.posts} post${d.posts !== 1 ? 's' : ''}`]),
                el('span', {}, [`${fmtNum(d.engagement)} eng.`]),
                el('span', {}, [`${avgEngPlat} avg`]),
              ]),
              d.views > 0 ? el('div', { className: 'marketing-plat-rate' }, [
                `${((d.engagement / d.views) * 100).toFixed(1)}% eng. rate`,
              ]) : null,
            ]);
          })
        ),
      ]);
      container.append(platSection);
    }

    /* ---------- Topic insights ---------- */
    const topicKeys = Object.keys(topicStats).sort((a, b) => topicStats[b].engagement - topicStats[a].engagement);
    if (topicKeys.length >= 2) {
      const topicSection = el('div', { className: 'marketing-topics' }, [
        el('div', { className: 'marketing-section-title' }, ['🏷️ Topics That Resonate']),
        el('div', { className: 'marketing-topic-list' },
          topicKeys.slice(0, 8).map(tk => {
            const d = topicStats[tk];
            const avgEng = d.posts > 0 ? Math.round(d.engagement / d.posts) : 0;
            return el('div', { className: 'marketing-topic-chip' }, [
              el('span', { className: 'marketing-topic-name' }, [tk]),
              el('span', { className: 'marketing-topic-stat' }, [`${d.posts} · ${fmtNum(d.engagement)} eng · ${avgEng} avg`]),
            ]);
          })
        ),
      ]);
      container.append(topicSection);
    }

    /* ---------- Post cards ---------- */
    const cardList = el('div', { className: 'marketing-card-list' });

    /* Delegated status cycling */
    delegateEvent(container, 'click', '.marketing-stage-btn', (e, btn) => {
      const next = cycleStatus(btn, STATUSES, template.stageClass, 'marketing-stage-btn marketing-stage-');
      const card = btn.closest('.marketing-card');
      if (card) {
        const newCls = template.stageClass(next);
        card.className = `marketing-card marketing-card-${newCls}`;
      }
      emitEdit(Number(btn.dataset.rowIdx), cols.status, next);
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const postText  = cell(row, cols.post) || row[0] || '';
      const platform  = cell(row, cols.platform);
      const status    = cell(row, cols.status);
      const topic     = cell(row, cols.topic);
      const date      = cell(row, cols.date);
      const likes     = parseNum(cell(row, cols.likes));
      const shares    = parseNum(cell(row, cols.shares));
      const comments  = parseNum(cell(row, cols.comments));
      const views     = parseNum(cell(row, cols.views));
      const link      = cell(row, cols.link);
      const takeaway  = cell(row, cols.takeaway);
      const cls       = template.stageClass(status);
      const pk        = platformKey(platform);
      const platMeta  = PLATFORM_META[pk];
      const eng       = likes + shares + comments;
      const rate      = engRate(likes, shares, comments, views);
      const wc        = wordCount(postText);

      const statusBadge = el('button', {
        className: `marketing-stage-btn marketing-stage-${cls}`,
        title: 'Click to cycle status',
        dataset: { rowIdx: String(rowIdx) },
      }, [status || 'Idea']);

      const platBadge = el('span', {
        className: 'marketing-card-platform',
        style: `color: ${platMeta.color}; background: ${platMeta.bg}`,
      }, [`${platMeta.emoji} ${platMeta.label}`]);

      /* Engagement bar — only show for posted content */
      const engBar = (cls === 'posted' || cls === 'analyzing') && eng > 0
        ? el('div', { className: 'marketing-card-eng' }, [
            likes  ? el('span', { className: 'marketing-eng-stat', title: 'Likes' },    [`❤️ ${fmtNum(likes)}`])    : null,
            shares ? el('span', { className: 'marketing-eng-stat', title: 'Shares' },   [`🔄 ${fmtNum(shares)}`])   : null,
            comments ? el('span', { className: 'marketing-eng-stat', title: 'Comments' }, [`💬 ${fmtNum(comments)}`]) : null,
            views  ? el('span', { className: 'marketing-eng-stat', title: 'Views' },    [`👁 ${fmtNum(views)}`])    : null,
            rate   ? el('span', { className: 'marketing-eng-rate', title: 'Engagement rate' }, [`${rate}%`]) : null,
          ])
        : null;

      const cardEl = el('div', { className: `marketing-card marketing-card-${cls}` }, [
        el('div', { className: 'marketing-card-header' }, [
          platBadge,
          statusBadge,
          topic ? el('span', { className: 'marketing-card-topic' }, [topic]) : null,
        ]),
        editableCell('div', { className: 'marketing-card-body' }, postText, rowIdx, cols.post),
        el('div', { className: 'marketing-card-meta' }, [
          el('span', { className: 'marketing-card-wc' }, [`${wc} words`]),
          date ? el('span', { className: 'marketing-card-date' }, [date]) : null,
          link ? el('a', { className: 'marketing-card-link', href: link, target: '_blank', rel: 'noopener noreferrer' }, ['🔗 Link']) : null,
        ]),
        engBar,
        cols.takeaway >= 0 ? editableCell('div', { className: 'marketing-card-takeaway' }, takeaway ? `💡 ${takeaway}` : '', rowIdx, cols.takeaway, {
          placeholder: 'What did you learn from this post?',
        }) : null,
      ]);

      cardList.append(cardEl);
    }

    container.append(cardList);
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'marketing-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'marketing-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'marketing-dir-icon tmpl-dir-icon' }, ['📣']),
      el('span', { className: 'marketing-dir-title tmpl-dir-title' }, ['Content Workbenches']),
      el('span', { className: 'marketing-dir-count tmpl-dir-count' }, [
        `${sheets.length} workbench${sheets.length !== 1 ? 'es' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'marketing-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      const cols = sheet.cols || {};
      let totalEng = 0;
      let posted = 0;
      for (const row of rows) {
        const likes = parseNum(cell(row, cols.likes));
        const shares = parseNum(cell(row, cols.shares));
        const comments = parseNum(cell(row, cols.comments));
        totalEng += likes + shares + comments;
        const st = (cell(row, cols.status) || '').toLowerCase();
        if (/post|live|sent|publish|analyz/.test(st)) posted++;
      }

      grid.append(el('div', {
        className: 'marketing-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'marketing-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'marketing-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} posts · ${posted} published · ${fmtNum(totalEng)} engagements`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.marketing-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('marketing', definition);
export default definition;
