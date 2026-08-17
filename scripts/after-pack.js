'use strict';

// Strip locale packs from the packaged app.
//
// Electron ships ~55 Chromium locales, about 40 MB of .lproj folders inside
// the framework. `electronLanguages` only prunes the app-level ones, which are
// already empty, so the real payload has to be removed here.
//
// The cost: Chromium's own built-in UI (the context menu, dialogs) falls back
// to English. Kai's own interface is English-only anyway.

const fs = require('fs');
const path = require('path');

const KEEP = new Set(['en.lproj', 'en_GB.lproj', 'en-GB.lproj', 'en_US.lproj', 'en-US.lproj']);

function pruneLproj(dir) {
  if (!fs.existsSync(dir)) return 0;
  let freed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.lproj') || KEEP.has(entry)) continue;
    const target = path.join(dir, entry);
    freed += sizeOf(target);
    fs.rmSync(target, { recursive: true, force: true });
  }
  return freed;
}

function sizeOf(target) {
  let total = 0;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(target)) total += sizeOf(path.join(target, child));
  } else {
    total = stat.size;
  }
  return total;
}

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  let freed = 0;

  if (context.electronPlatformName === 'darwin') {
    const appName = packager.appInfo.productFilename;
    const resources = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
    const framework = path.join(
      appOutDir,
      `${appName}.app`,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources'
    );
    freed += pruneLproj(resources);
    freed += pruneLproj(framework);
  } else {
    // Windows and Linux keep locales as flat .pak files.
    const localesDir = path.join(appOutDir, 'locales');
    if (fs.existsSync(localesDir)) {
      for (const file of fs.readdirSync(localesDir)) {
        if (file === 'en-US.pak' || file === 'en-GB.pak') continue;
        const target = path.join(localesDir, file);
        freed += sizeOf(target);
        fs.rmSync(target, { force: true });
      }
    }
  }

  console.log(`  • pruned locales  freed=${(freed / 1024 / 1024).toFixed(1)} MB`);
};
