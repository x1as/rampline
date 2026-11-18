const fs = require('fs'), path = require('path');
const d = __dirname, r = f => fs.readFileSync(path.join(d, f), 'utf8');
const js = ['core.js', 'maps.js', 'render.js', 'ninja.js', 'game.js'].map(r).join('\n');
const html = r('page.html') +
  '\n<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>\n<script>\n' + js + '\n</script>\n';
fs.mkdirSync(path.join(d, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(d, '..', 'dist', 'rampline.html'), html);
// local preview wrapper with a full document
fs.writeFileSync(path.join(d, '..', 'dist', 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + html + '</body></html>');
console.log('built', (html.length / 1024).toFixed(1) + 'KB');
