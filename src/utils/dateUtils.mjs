/**
 * Formats a timestamp or Date object into a human-readable relative time string.
 *
 * @param {Date|number|string} input - Timestamp (number), Date object, or numeric string.
 * @returns {string} - Human-readable relative time (e.g., "5 minutes ago").
 * @throws {TypeError} - If input is null, undefined, NaN, or a non-numeric string.
 */
export function formatRelativeTime(input) {
  if (input === null || input === undefined) {
    throw new TypeError('Input cannot be null or undefined');
  }

  let date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'number') {
    if (Number.isNaN(input)) throw new TypeError('Input cannot be NaN');
    date = new Date(input);
  } else if (typeof input === 'string') {
    const num = Number(input);
    if (input.trim() === '' || Number.isNaN(num)) {
      throw new TypeError('Input cannot be a non-numeric string');
    }
    date = new Date(num);
  } else {
    throw new TypeError('Input must be a Date object or numeric timestamp');
  }

  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }

  const now = Date.now();
  const diffInSeconds = Math.floor((now - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'just now';
  }

  const minute = 60;
  const hour = 3600;
  const day = 86400;
  const week = 604800;
  const month = 2592000;
  const year = 31536000;

  if (diffInSeconds < hour) {
    const n = Math.floor(diffInSeconds / minute);
    return `${n} minute${n === 1 ? '' : 's'} ago`;
  }
  if (diffInSeconds < day) {
    const n = Math.floor(diffInSeconds / hour);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  if (diffInSeconds < week) {
    const n = Math.floor(diffInSeconds / day);
    return `${n} day${n === 1 ? '' : 's'} ago`;
  }
  if (diffInSeconds < month) {
    const n = Math.floor(diffInSeconds / week);
    return `${n} week${n === 1 ? '' : 's'} ago`;
  }
  if (diffInSeconds < year) {
    const n = Math.floor(diffInSeconds / month);
    return `${n} month${n === 1 ? '' : 's'} ago`;
  }
  const n = Math.floor(diffInSeconds / year);
  return `${n} year${n === 1 ? '' : 's'} ago`;
}

/**
 * Formats a timestamp or Date object into a locale-aware short date string.
 *
 * @param {Date|number|string} input - Timestamp (number), Date object, or parseable date string.
 * @returns {string} - Locale-aware short date string (e.g., "May 17, 2026").
 * @throws {TypeError} - If input is null, undefined, NaN, or non-date-parseable.
 */
export function formatShortDate(input) {
  if (input === null || input === undefined) {
    throw new TypeError('Input cannot be null or undefined');
  }

  let date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'number') {
    if (Number.isNaN(input)) throw new TypeError('Input cannot be NaN');
    date = new Date(input);
  } else if (typeof input === 'string') {
    date = new Date(input);
  } else {
    date = new Date(NaN);
  }

  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Returns true if the given date falls on today's calendar date in local time.
 *
 * @param {Date|number|string} input - Timestamp (number), Date object, or numeric string.
 * @returns {boolean} - True if the date is today.
 * @throws {TypeError} - If input is null, undefined, NaN, or a non-numeric string.
 */
export function isToday(input) {
  if (input === null || input === undefined) {
    throw new TypeError('Input cannot be null or undefined');
  }

  let date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'number') {
    if (Number.isNaN(input)) throw new TypeError('Input cannot be NaN');
    date = new Date(input);
  } else if (typeof input === 'string') {
    const num = Number(input);
    if (input.trim() === '' || Number.isNaN(num)) {
      throw new TypeError('Input cannot be a non-numeric string');
    }
    date = new Date(num);
  } else {
    throw new TypeError('Input must be a Date object or numeric timestamp');
  }

  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }

  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}