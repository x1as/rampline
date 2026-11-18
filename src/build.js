const fs = require('fs'), path = require('path');
const d = __dirname, r = f => fs.readFileSync(path.join(d, f), 'utf8');
const js = ['core.js', 'maps.js', 'render.js', 'ninja.js', 'game.js'].map(r).join('\n');
const html = r('page.html') +
  '\n<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>\n<script>\n' + js + '\n</script>\n';
fs.mkdirSync(path.join(d, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(d, '..', 'dist', 'rampline.html'), html);
// local preview wrapper with a full document
const icons = '<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" type="image/png" href="icon-192.png" sizes="192x192"><link rel="apple-touch-icon" href="apple-touch-icon.png"><meta name="theme-color" content="#2b1240">';
fs.writeFileSync(path.join(d, '..', 'dist', 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + icons + '</head><body>' + html + '</body></html>');
for (const f of fs.readdirSync(path.join(d, 'icons'))) fs.copyFileSync(path.join(d, 'icons', f), path.join(d, '..', 'dist', f));
console.log('built', (html.length / 1024).toFixed(1) + 'KB');
