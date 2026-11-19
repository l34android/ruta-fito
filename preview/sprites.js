/* Pixel-art sprites for Fito (Bernese mountain dog) and map icons. Drawn from scratch.
   Each sprite is an array of strings; one char = one pixel. '.' = transparent. */
(function (root) {
  const PAL = {
    K: '#141414', // Fito black
    W: '#ffffff',
    R: '#c0662b', // Bernese rust
    T: '#e4262c', // tongue / red
    Y: '#ffd400', // arcade yellow
    N: '#0b0b1a', // outline night
    B: '#1a2350', // panel blue
    G: '#3ddc84', // tree green (icons only)
  };

  const FACE = [
    '................',
    '..KK........KK..',
    '.KKKKKKKKKKKKKK.',
    '.KKKKKKWWKKKKKK.',
    'KKKKRKKWWKKRKKKK',
    'KKKKKKWWWWKKKKKK',
    'KKKWKKWWWWKKWKKK',
    'KKKKRWWWWWWRKKKK',
    'KKKRRWWWWWWRRKKK',
    '.KKRRWWKKWWRRKK.',
    '.KKRWWWKKWWWRKK.',
    '..KRWWWWWWWWRK..',
    '..KRWWWWWWWWRK..',
    '...KWWWTTWWWK...',
    '....KWWWWWWK....',
    '......KKKK......',
  ];

  // Side view, facing right, 32x24, without tail.
  const BODY = [
    '................................',
    '.....................KKKKK......',
    '....................KKKKKKKK....',
    '...................KKKKWWKKKK...',
    '...................KKKRWWKRKK...',
    '..................KKKKKWWWKKKK..',
    '..................KKKKWKWWWWWKK.',
    '..................KKKKKRWWWWWWWK',
    '..................KKKKRRWWWWWWK.',
    '...................KKKRRWWWWWT..',
    '...................KKKKWWWWW....',
    '....KKKKKKKKKKKKKKKKKKWWWWWW....',
    '...KKKKKKKKKKKKKKKKKKWWWWWWW....',
    '...KKKKKKKKKKKKKKKKKKWWWWWWK....',
    '...KKKKKKKKKKKKKKKKKKKWWWWKK....',
    '...KKKKKKKKKKKKKKKKKKKKWWKKK....',
    '....KKKKKKKKKKKKKKKKKKKKKKK.....',
    '....RRKK.RRKK......RRKK.RRKK....',
    '....RRKK.RRKK......RRKK.RRKK....',
    '....RRRK.RRRK......RRRK.RRRK....',
    '....RRRR.RRRR......RRRR.RRRR....',
    '....WWWW.WWWW......WWWW.WWWW....',
    '................................',
    '................................',
  ];
  const LEG_ROWS = 17; // rows >= this don't bob

  // Tail overlays: [row, col, chars]
  const TAILS = {
    up:   [[5, 0, 'W'], [6, 0, 'KK'], [7, 0, 'KK'], [8, 1, 'KK'], [9, 1, 'KKK'], [10, 2, 'KK']],
    mid:  [[10, 0, 'WKK'], [11, 0, 'KKKK'], [12, 1, 'KK']],
    down: [[12, 2, 'K'], [13, 1, 'KK'], [14, 0, 'KK'], [15, 0, 'KK'], [16, 0, 'W']],
  };

  function bodyFrame(tail, bob) {
    const h = BODY.length, w = BODY[0].length;
    const g = Array.from({ length: h }, () => Array(w).fill('.'));
    for (let r = 0; r < h; r++) {
      const src = r >= LEG_ROWS ? r : r - bob; // bob shifts body down by `bob`
      if (src < 0 || src >= h) continue;
      for (let c = 0; c < w; c++) if (BODY[src][c] !== '.') g[r][c] = BODY[src][c];
    }
    // keep legs attached when bobbing
    for (const [r, c, s] of TAILS[tail]) [...s].forEach((ch, i) => { if (g[r + bob]) g[r + bob][c + i] = ch; });
    return g.map((row) => row.join(''));
  }
  // 4-frame loop: wag up, mid (bob), down, mid (bob)
  const FITO_FRAMES = [bodyFrame('up', 0), bodyFrame('mid', 1), bodyFrame('down', 0), bodyFrame('mid', 1)];

  const ICONS = {
    descanso: [ // tree
      '....GGGG....', '..GGGGGGGG..', '.GGGGGGGGGG.', 'GGGGGGGGGGGG', 'GGGGGGGGGGGG', '.GGGGGGGGGG.',
      '..GGGGGGGG..', '....GGGG....', '.....RR.....', '.....RR.....', '.....RR.....', '....RRRR....'],
    nafta: [ // fuel pump
      '.YYYYYY.....', '.YWWWWY..Y..', '.YWWWWY...Y.', '.YYYYYY...Y.', '.YYYYYYY..Y.', '.YYYYYY.Y.Y.',
      '.YYYYYY..YY.', '.YYYYYY.....', '.YYYYYY.....', '.YYYYYY.....', 'YYYYYYYY....', 'YYYYYYYY....'],
    noche: [ // bed
      '............', '............', 'Y...........', 'Y.WW........', 'YWWWW.......', 'YWWWWTTTTTTT',
      'YTTTTTTTTTTT', 'YTTTTTTTTTTT', 'YYYYYYYYYYYY', 'Y..........Y', 'Y..........Y', '............'],
    destino: [ // checkered flag
      'Y...........', 'YWWKKWWKK...', 'YWWKKWWKK...', 'YKKWWKKWW...', 'YKKWWKKWW...', 'YWWKKWWKK...',
      'YWWKKWWKK...', 'Y...........', 'Y...........', 'Y...........', 'Y...........', 'YYY.........'],
    salida: [ // pin
      '...TTTTTT...', '..TTTTTTTT..', '.TTTWWWWTTT.', '.TTWWWWWWTT.', '.TTWWWWWWTT.', '.TTTWWWWTTT.',
      '..TTTTTTTT..', '...TTTTTT...', '....TTTT....', '.....TT.....', '.....TT.....', '............'],
    tab_map: [
      'YYY.....YYY.', 'Y.YY...YY.Y.', 'Y..YYYYY..Y.', 'Y...Y..Y..Y.', 'Y...Y..Y..Y.', 'Y...Y..Y..Y.',
      'Y...Y..Y..Y.', 'Y...Y..Y..Y.', 'Y...Y..Y..Y.', 'YY..YYYY..Y.', '.YYYY..YYYY.', '............'],
    tab_list: [
      '............', 'YY.YYYYYYYY.', 'YY.YYYYYYYY.', '............', 'YY.YYYYYYYY.', 'YY.YYYYYYYY.',
      '............', 'YY.YYYYYYYY.', 'YY.YYYYYYYY.', '............', '............', '............'],
    tab_chat: [
      '.YYYYYYYYYY.', 'Y..........Y', 'Y.YYYYYYYY.Y', 'Y..........Y', 'Y.YYYYYY...Y', 'Y..........Y',
      '.YYYYYYYYYY.', '...YY.......', '..YY........', '.YY.........', '............', '............'],
  };

  function toCanvas(rows, scale, outline) {
    const h = rows.length, w = rows[0].length, pad = outline ? 1 : 0;
    const cv = (root.document || {}).createElement ? root.document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = (w + pad * 2) * scale; cv.height = (h + pad * 2) * scale;
    const ctx = cv.getContext('2d');
    if (outline) { // 1px night outline around opaque pixels, for contrast on the map
      ctx.fillStyle = PAL.N;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (rows[r][c] !== '.')
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) ctx.fillRect((c + pad + dc) * scale, (r + pad + dr) * scale, scale, scale);
    }
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const ch = rows[r][c]; if (ch === '.') continue;
      ctx.fillStyle = PAL[ch]; ctx.fillRect((c + pad) * scale, (r + pad) * scale, scale, scale);
    }
    return cv;
  }
  function dataUrl(rows, scale, outline = true) { return toCanvas(rows, scale, outline).toDataURL('image/png'); }
  // Horizontal sprite sheet for CSS steps() animation.
  function sheetUrl(frames, scale, outline = true) {
    const cvs = frames.map((f) => toCanvas(f, scale, outline));
    const out = root.document.createElement('canvas');
    out.width = cvs[0].width * cvs.length; out.height = cvs[0].height;
    const ctx = out.getContext('2d'); cvs.forEach((c, i) => ctx.drawImage(c, i * c.width, 0));
    return { url: out.toDataURL('image/png'), w: cvs[0].width, h: cvs[0].height, n: cvs.length };
  }

  root.SPRITES = { PAL, FACE, FITO_FRAMES, ICONS, dataUrl, sheetUrl };
  if (typeof module !== 'undefined') module.exports = root.SPRITES;
})(typeof window !== 'undefined' ? window : globalThis);
