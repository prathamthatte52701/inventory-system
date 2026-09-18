// Minimal PDF text extractor for pdfkit output: inflate every stream, join the hex strings of each TJ array.
// Used instead of pdf-parse, whose 2018 pdf.js rejects valid pdfkit files at random.
const zlib = require('zlib');

module.exports = function pdfText(buf) {
  const bin = buf.toString('latin1');
  let out = '';
  for (const m of bin.matchAll(/>>\s*stream\r?\n([\s\S]*?)\nendstream/g)) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const tj of s.matchAll(/\[(.*?)\]\s*TJ/g)) {
      out += [...tj[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => Buffer.from(x[1], 'hex').toString('latin1')).join('') + '\n';
    }
  }
  return out;
};
