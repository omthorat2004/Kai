'use strict';

// Update check against GitHub releases.
//
// Deliberately notify-only: it tells you a newer version exists and opens the
// release page. It does not replace the app in place, because Squirrel.Mac
// refuses to apply an update to a build that is not signed with a Developer ID
// certificate. Once this app is signed and notarised, swap this module for
// electron-updater and the same release feed keeps working.

const https = require('https');

const REPO = 'omthorat2004/Kai';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 8000;

/** Compare two semver-ish strings. Returns true when `a` is newer than `b`. */
function isNewer(a, b) {
  const parse = (v) =>
    String(v || '0')
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((n) => (Number.isNaN(parseInt(n, 10)) ? 0 : parseInt(n, 10)));
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const dx = x[i] || 0;
    const dy = y[i] || 0;
    if (dx !== dy) return dx > dy;
  }
  return false;
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      API,
      { headers: { 'User-Agent': 'Kai-updater', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          return reject(new Error('No releases published yet'));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GitHub responded ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (err) { reject(new Error('Could not parse the release feed')); }
        });
      }
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Update check timed out')));
    req.on('error', reject);
  });
}

/**
 * @param {string} currentVersion
 * @returns {Promise<{available:boolean, version?:string, url?:string, notes?:string, error?:string}>}
 */
async function checkForUpdate(currentVersion) {
  try {
    const release = await fetchLatest();
    const latest = String(release.tag_name || release.name || '').replace(/^v/, '');
    if (!latest) return { available: false, current: currentVersion };
    return {
      available: isNewer(latest, currentVersion),
      current: currentVersion,
      version: latest,
      url: release.html_url,
      notes: (release.body || '').slice(0, 600),
      publishedAt: release.published_at,
    };
  } catch (err) {
    return { available: false, current: currentVersion, error: err.message };
  }
}

module.exports = { checkForUpdate, isNewer };
