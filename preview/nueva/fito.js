/* Fito (Bernese mountain dog) as flat vector illustrations, drawn from scratch.
   face(): round avatar for the map while driving. body(): full body with a wagging tail for stops. */
(function (root) {
  const C = { black: '#141414', white: '#f5f5f7', rust: '#c0662b', rustDark: '#9e4f1d', eye: '#2a1a10', tongue: '#e85d75', line: '#2c2c2e' };

  const face = (title = 'Fito') => `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
  <ellipse cx="12" cy="31" rx="8" ry="14" fill="${C.black}" transform="rotate(14 12 31)"/>
  <ellipse cx="52" cy="31" rx="8" ry="14" fill="${C.black}" transform="rotate(-14 52 31)"/>
  <path d="M32 8C47 8 53 19 53 32c0 14-9.5 24-21 24S11 46 11 32C11 19 17 8 32 8z" fill="${C.black}"/>
  <path d="M32 12c2.6 0 3.6 5 4 11l2 11H26l2-11c.4-6 1.4-11 4-11z" fill="${C.white}"/>
  <ellipse cx="19.5" cy="40" rx="5" ry="6" fill="${C.rust}"/>
  <ellipse cx="44.5" cy="40" rx="5" ry="6" fill="${C.rust}"/>
  <ellipse cx="32" cy="42" rx="12.5" ry="10.5" fill="${C.white}"/>
  <circle cx="22" cy="23.5" r="2.8" fill="${C.rust}"/>
  <circle cx="42" cy="23.5" r="2.8" fill="${C.rust}"/>
  <circle cx="23" cy="30" r="3.2" fill="${C.eye}"/><circle cx="24" cy="29" r="1" fill="#fff"/>
  <circle cx="41" cy="30" r="3.2" fill="${C.eye}"/><circle cx="42" cy="29" r="1" fill="#fff"/>
  <path d="M27 37.5q5-3 10 0q0 4-5 4.5q-5-.5-5-4.5z" fill="${C.black}"/>
  <path d="M32 42v3M28 46q4 3 8 0" stroke="${C.black}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M30.2 47.2q1.8 4.6 3.6 0z" fill="${C.tongue}"/>
</svg>`;

  const body = (title = 'Fito moviendo la cola') => `
<svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}" class="fito-body">
  <g class="fito-tail">
    <path d="M29 44C15 42 6 30 9 15c1-3 4-4 6-2 2 9 8 17 17 22z" fill="${C.black}"/>
    <path d="M9 15c-1 3 0 7 2 9 3-2 4-6 4-11-2-2-5-1-6 2z" fill="${C.white}"/>
  </g>
  <g class="fito-breathe">
    <rect x="41" y="54" width="8" height="24" rx="3.5" fill="${C.rustDark}"/>
    <rect x="83" y="54" width="8" height="24" rx="3.5" fill="${C.rustDark}"/>
    <rect x="41" y="72" width="8" height="7" rx="3" fill="#d8d8dc"/>
    <rect x="83" y="72" width="8" height="7" rx="3" fill="#d8d8dc"/>
    <path d="M25 45c0-10 10-15 24-15h27c12 0 17 7 17 16 0 11-8 16-18 16H38c-8 0-13-7-13-17z" fill="${C.black}"/>
    <path d="M81 35c10 2 14 12 10 22-4 5-10 3-12-3-2-8-2-14 2-19z" fill="${C.white}"/>
    <rect x="31" y="56" width="9" height="24" rx="4" fill="${C.rust}"/>
    <rect x="72" y="56" width="9" height="24" rx="4" fill="${C.rust}"/>
    <rect x="31" y="73" width="9" height="8" rx="3.5" fill="${C.white}"/>
    <rect x="72" y="73" width="9" height="8" rx="3.5" fill="${C.white}"/>
    <g class="fito-head">
      <circle cx="92" cy="24" r="15" fill="${C.black}"/>
      <path d="M86 14c-6 2-8 10-7 18 1 6 4 9 7 9 3-1 4-6 4-12 0-7-1-13-4-15z" fill="#262628"/>
      <path d="M95 9c3 0 4 6 5 12l3 9h-9l-1-9c0-6 0-12 2-12z" fill="${C.white}"/>
      <ellipse cx="104" cy="31" rx="10.5" ry="7.5" fill="${C.white}"/>
      <ellipse cx="97" cy="33" rx="4.2" ry="3.6" fill="${C.rust}"/>
      <circle cx="96.5" cy="16.5" r="2" fill="${C.rust}"/>
      <circle cx="96" cy="21.5" r="2.4" fill="${C.eye}"/><circle cx="96.8" cy="20.8" r=".8" fill="#fff"/>
      <ellipse cx="113.5" cy="29" rx="3.2" ry="2.6" fill="${C.black}"/>
      <path d="M104 37.5q2 5 4.5 0z" fill="${C.tongue}"/>
    </g>
  </g>
</svg>`;

  root.FITO = { face, body, colors: C };
  if (typeof module !== 'undefined') module.exports = root.FITO;
})(typeof window !== 'undefined' ? window : globalThis);
