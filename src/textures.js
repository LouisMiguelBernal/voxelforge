import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Smooth procedural PBR atlas — 128x128 per tile, 8x4 grid (1024x512).
// Produces diffuse + normal (sobel-from-height) + emissive maps, all generated
// in code with tileable fBm value noise. Linear filtering + mipmaps + aniso:
// the "smooth 3D" look, still zero external assets.
// ---------------------------------------------------------------------------

const RES = 128
const COLS = 8
const ROWS = 4
const ATLAS_W = COLS * RES
const ATLAS_H = ROWS * RES

export const TILES = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3,
  woodSide: 4, woodTop: 5, leaves: 6, ash: 7,
  plank: 8, brick: 9, glass: 10, brass: 11,
  ironPlate: 12, darkIron: 13, bone: 14, hazard: 15,
  ember: 16, gothic: 17
}

function all(t) { return [t, t, t, t, t, t] }
function face(side, top, bottom) { return [side, side, top, bottom, side, side] }

export const BLOCKS = {
  1:  { name: 'Grass',        faces: face(TILES.grassSide, TILES.grassTop, TILES.dirt) },
  2:  { name: 'Dirt',         faces: all(TILES.dirt) },
  3:  { name: 'Stone',        faces: all(TILES.stone) },
  4:  { name: 'Gnarlwood',    faces: face(TILES.woodSide, TILES.woodTop, TILES.woodTop) },
  5:  { name: 'Blightleaf',   faces: all(TILES.leaves) },
  6:  { name: 'Ash',          faces: all(TILES.ash) },
  7:  { name: 'Plank',        faces: all(TILES.plank) },
  8:  { name: 'Brick',        faces: all(TILES.brick) },
  9:  { name: 'Glass',        faces: all(TILES.glass) },
  10: { name: 'Brass',        faces: all(TILES.brass) },
  11: { name: 'Iron Plate',   faces: all(TILES.ironPlate) },
  12: { name: 'Dark Iron',    faces: all(TILES.darkIron) },
  13: { name: 'Bone Pile',    faces: all(TILES.bone) },
  14: { name: 'Hazard Plate', faces: all(TILES.hazard) },
  15: { name: 'Ember Rock',   faces: all(TILES.ember) },
  16: { name: 'Gothic Stone', faces: all(TILES.gothic) }
}

export const BLOCK_COLORS = {
  1: '#557a34', 2: '#5d472f', 3: '#6a707a', 4: '#5f4826', 5: '#33531f',
  6: '#84806f', 7: '#6a4f2a', 8: '#7a3a2c', 9: '#aecad8', 10: '#a8863c',
  11: '#6e6459', 12: '#2e3138', 13: '#c8bd9f', 14: '#d0a825', 15: '#ff7a20',
  16: '#575263'
}

// ---- noise ---------------------------------------------------------------

function h(x, y, s) {
  let n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}

// tileable value noise: lattice wraps with the given period
function wnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const w = (a, b) => h(((a % period) + period) % period, ((b % period) + period) % period, seed)
  return w(xi, yi) * (1 - u) * (1 - v) + w(xi + 1, yi) * u * (1 - v) +
         w(xi, yi + 1) * (1 - u) * v + w(xi + 1, yi + 1) * u * v
}

// fBm over tile-space coords (x,y in [0,1)); tileable per octave
function fbm(x, y, seed, oct = 4, baseP = 6) {
  let a = 0, amp = 0.5, p = baseP
  for (let i = 0; i < oct; i++) {
    a += amp * wnoise(x * p, y * p, p, seed + i * 13)
    amp *= 0.5; p *= 2
  }
  return a / 0.9375
}

// ---- color helpers -------------------------------------------------------

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
function scale(c, s) { return [c[0] * s, c[1] * s, c[2] * s] }
const sstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ---- per-tile painters: fn(u, v, px, py) -> [r,g,b]  (u,v in [0,1)) ------

const P = {}

P[TILES.stone] = (u, v) => {
  const t = fbm(u, v, 31)
  let c = mix(rgb('#565b64'), rgb('#7d838d'), t)
  const crack = fbm(u * 2 % 1, v * 2 % 1, 47, 3, 8)
  if (Math.abs(crack - 0.5) < 0.02) c = scale(c, 0.55)      // crack lines
  if (fbm(u, v, 63, 2, 24) > 0.72) c = scale(c, 1.12)       // mineral glints
  return c
}

P[TILES.grassTop] = (u, v) => {
  const t = fbm(u, v, 11)
  let c = mix(rgb('#3a5f26'), rgb('#6f9b40'), t)
  if (fbm(u, v, 17, 3, 4) < 0.36) c = scale(c, 0.8)         // dark patches
  const blades = wnoise(u * 48, v * 12, 48, 21)              // fine streaks
  if (blades > 0.8) c = scale(c, 1.18)
  return c
}

P[TILES.dirt] = (u, v) => {
  const t = fbm(u, v, 13)
  let c = mix(rgb('#4a3a26'), rgb('#6f5638'), t)
  if (fbm(u, v, 19, 3, 16) > 0.78) c = mix(c, rgb('#8a857b'), 0.6)   // pebbles
  if (fbm(u, v, 23, 2, 5) < 0.3) c = scale(c, 0.82)
  return c
}

P[TILES.grassSide] = (u, v) => {
  const c = P[TILES.dirt](u, v)
  const edge = 0.16 + fbm(u, 0.5, 29, 3, 10) * 0.1           // ragged grass lip
  if (v < edge) return P[TILES.grassTop](u, v * 4 % 1)
  return c
}

P[TILES.ash] = (u, v) => {
  const t = fbm(u, v, 18)
  let c = mix(rgb('#6a675f'), rgb('#9a968c'), t)
  if (fbm(u, v, 25, 2, 20) > 0.8) c = scale(c, 0.6)          // charred flecks
  return c
}

P[TILES.woodSide] = (u, v) => {
  const grain = 0.5 + 0.5 * Math.sin((u * 7 + fbm(u, v, 5, 3, 4) * 1.6) * Math.PI * 2)
  let c = mix(rgb('#43301a'), rgb('#77592f'), grain)
  c = scale(c, 0.9 + fbm(u, v, 9, 2, 12) * 0.2)
  return c
}

P[TILES.woodTop] = (u, v) => {
  const dx = u - 0.5, dy = v - 0.5
  const r = Math.hypot(dx, dy) * 2
  const ring = 0.5 + 0.5 * Math.sin((r * 6 + fbm(u, v, 16, 3, 6) * 1.2) * Math.PI * 2)
  return mix(rgb('#503a1e'), rgb('#8a6a38'), ring)
}

P[TILES.leaves] = (u, v) => {
  const t = fbm(u, v, 27, 4, 8)
  let c = mix(rgb('#22421c'), rgb('#4a7a2e'), sstep(0.3, 0.75, t))
  if (t < 0.28) c = scale(c, 0.55)                           // shadow holes
  if (fbm(u, v, 33, 2, 24) > 0.82) c = scale(c, 1.2)         // leaf highlights
  return c
}

P[TILES.plank] = (u, v) => {
  const board = Math.floor(v * 4)
  const bv = (v * 4) % 1
  const tone = 0.85 + h(board, 3, 41) * 0.3
  const grain = 0.5 + 0.5 * Math.sin((v * 3 + u * 1.2 + fbm(u, v, 43, 3, 6)) * Math.PI * 4)
  let c = scale(mix(rgb('#4f3a1e'), rgb('#7a5c30'), grain), tone)
  if (bv < 0.05 || bv > 0.95) c = scale(c, 0.5)              // board gaps
  else if (bv < 0.12) c = scale(c, 1.15)                     // top bevel light
  return c
}

P[TILES.brick] = (u, v) => {
  const row = Math.floor(v * 4)
  const bu = ((u + (row % 2) * 0.25) * 2) % 1
  const bv = (v * 4) % 1
  const mortar = bv < 0.1 || bv > 0.9 || bu < 0.05 || bu > 0.95
  if (mortar) return mix(rgb('#7d766b'), rgb('#8f887c'), fbm(u, v, 51, 2, 12))
  let c = mix(rgb('#6a2f24'), rgb('#8f4a34'), fbm(u, v, 53, 3, 10))
  if (bv < 0.2 || bu < 0.12) c = scale(c, 1.14)              // bevel light
  if (bv > 0.8 || bu > 0.88) c = scale(c, 0.8)               // bevel shadow
  return c
}

P[TILES.glass] = (u, v) => {
  let c = mix(rgb('#9db8c8'), rgb('#c8dde8'), fbm(u, v, 57, 2, 4))
  const streak = Math.abs(((u + v) * 3) % 1 - 0.5)
  if (streak < 0.05) c = mix(c, [255, 255, 255], 0.45)       // diagonal sheen
  if (u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97) c = scale(c, 0.6)   // frame
  return c
}

P[TILES.brass] = (u, v) => {
  const brushed = fbm(u, v * 6 % 1, 61, 3, 6)                // horizontal brush
  let c = mix(rgb('#71581f'), rgb('#c9a24b'), brushed)
  if (fbm(u, v, 67, 2, 20) > 0.85) c = mix(c, [255, 240, 190], 0.5)    // glints
  return c
}

P[TILES.ironPlate] = (u, v) => {
  const brushed = fbm(u * 5 % 1, v, 71, 3, 6)
  let c = mix(rgb('#544c42'), rgb('#7d746a'), brushed)
  const sx = Math.abs(u - 0.5), sy = Math.abs(v - 0.5)
  if (sx < 0.015 || sy < 0.015) c = scale(c, 0.55)           // panel seams
  else if (sx < 0.035 || sy < 0.035) c = scale(c, 1.12)      // seam bevel
  for (const [rx, ry] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) {
    const d = Math.hypot(u - rx, v - ry)
    if (d < 0.045) {
      const dome = 1 - d / 0.045
      c = mix(c, [200, 195, 185], dome * 0.55)               // rivet dome
      if (u - rx > 0.01 && v - ry > 0.01) c = scale(c, 0.8)  // rivet shadow
    }
  }
  if (fbm(u, v, 73, 3, 5) > 0.72) c = mix(c, rgb('#7a4a26'), 0.5)      // rust
  return c
}

P[TILES.darkIron] = (u, v) => {
  const brushed = fbm(u * 6 % 1, v, 77, 3, 6)
  let c = mix(rgb('#23252b'), rgb('#3c3f48'), brushed)
  if (Math.abs(v - 0.33) < 0.012 || Math.abs(v - 0.66) < 0.012) c = scale(c, 0.5)
  if (v < 0.05) c = scale(c, 1.35)                           // top edge sheen
  return c
}

P[TILES.bone] = (u, v) => {
  let c = mix(rgb('#b0a488'), rgb('#ddd3b8'), fbm(u, v, 81))
  // heaped bone lumps: soft shaded blobs
  for (const [bx, by, br, s] of [[0.28, 0.3, 0.2, 83], [0.72, 0.42, 0.24, 87], [0.4, 0.72, 0.22, 89], [0.78, 0.8, 0.16, 91]]) {
    const d = Math.hypot(u - bx, v - by)
    if (d < br) {
      const dome = 1 - d / br
      c = mix(c, [235, 226, 200], dome * 0.5)
      if (u - bx > 0 && v - by > br * 0.3) c = scale(c, 0.88)
      // eye sockets on two of the lumps
      if ((s === 83 || s === 89) && (Math.hypot(u - bx - 0.06, v - by) < 0.035 || Math.hypot(u - bx + 0.06, v - by) < 0.035)) {
        c = rgb('#3a3226')
      }
    }
  }
  const crack = fbm(u * 2 % 1, v * 2 % 1, 93, 3, 8)
  if (Math.abs(crack - 0.5) < 0.012) c = scale(c, 0.6)
  return c
}

P[TILES.hazard] = (u, v) => {
  const stripe = ((u + v) * 4) % 1 < 0.5
  let c = stripe
    ? mix(rgb('#c9a020'), rgb('#e0bc35'), fbm(u, v, 95, 3, 8))
    : mix(rgb('#1e1c16'), rgb('#33302a'), fbm(u, v, 97, 3, 8))
  if (fbm(u, v, 99, 3, 10) > 0.78) c = mix(c, rgb('#6a6258'), 0.7)     // worn scratches
  return c
}

P[TILES.ember] = (u, v) => {
  const vein = 1 - Math.abs(2 * fbm(u, v, 101, 4, 5) - 1)    // ridged noise
  let c = mix(rgb('#331107'), rgb('#571e0c'), fbm(u, v, 103, 3, 8))
  if (vein > 0.72) {
    const heat = sstep(0.72, 0.97, vein)
    c = mix(rgb('#d84a10'), rgb('#ffd23d'), heat)
  }
  return c
}
// emissive companion: glowing veins only
const EMBER_EMISSIVE = (u, v) => {
  const vein = 1 - Math.abs(2 * fbm(u, v, 101, 4, 5) - 1)
  if (vein > 0.72) {
    const heat = sstep(0.72, 0.97, vein)
    return mix(rgb('#b33a0c'), rgb('#ffd23d'), heat)
  }
  return [0, 0, 0]
}

P[TILES.gothic] = (u, v) => {
  let c = mix(rgb('#4a4654'), rgb('#5f5a6c'), fbm(u, v, 107))
  const e = 0.07                                             // carved frame bevel
  if (u < e || v < e) c = scale(c, 1.25)
  if (u > 1 - e || v > 1 - e) c = scale(c, 0.55)
  // fluted columns
  for (const cx of [0.26, 0.74]) {
    const d = Math.abs(u - cx)
    if (d < 0.05 && v > 0.12 && v < 0.88) c = scale(c, 0.6 + (d / 0.05) * 0.55)
  }
  // central rosette relief
  const r = Math.hypot(u - 0.5, v - 0.5)
  if (r > 0.13 && r < 0.185) c = scale(c, 1.3)
  if (r < 0.06) c = scale(c, 0.5)
  return c
}

// ---- atlas assembly ------------------------------------------------------

function paintTile(diff, emis, slot) {
  const ox = (slot % COLS) * RES
  const oy = Math.floor(slot / COLS) * RES
  const painter = P[slot]
  const img = diff.createImageData(RES, RES)
  const d = img.data
  const eImg = emis.createImageData(RES, RES)
  const ed = eImg.data
  const emissiveFn = slot === TILES.ember ? EMBER_EMISSIVE : null
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const u = x / RES, v = y / RES
      const c = painter(u, v, x, y)
      const i = (y * RES + x) * 4
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
      if (emissiveFn) {
        const e = emissiveFn(u, v)
        ed[i] = e[0]; ed[i + 1] = e[1]; ed[i + 2] = e[2]
      }
      ed[(y * RES + x) * 4 + 3] = 255
    }
  }
  diff.putImageData(img, ox, oy)
  emis.putImageData(eImg, ox, oy)
}

// tangent-space normal map from diffuse luminance (sobel), clamped per tile
function buildNormalCanvas(diffCanvas) {
  const src = diffCanvas.getContext('2d').getImageData(0, 0, ATLAS_W, ATLAS_H).data
  const lum = new Float32Array(ATLAS_W * ATLAS_H)
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255
  }
  const cv = document.createElement('canvas')
  cv.width = ATLAS_W; cv.height = ATLAS_H
  const ctx = cv.getContext('2d')
  const out = ctx.createImageData(ATLAS_W, ATLAS_H)
  const o = out.data
  const at = (x, y, tx0, ty0) => {
    // clamp inside the tile so normals never bleed across atlas neighbors
    const cx = Math.max(tx0, Math.min(tx0 + RES - 1, x))
    const cy = Math.max(ty0, Math.min(ty0 + RES - 1, y))
    return lum[cy * ATLAS_W + cx]
  }
  const STR = 1.6
  for (let y = 0; y < ATLAS_H; y++) {
    const ty0 = Math.floor(y / RES) * RES
    for (let x = 0; x < ATLAS_W; x++) {
      const tx0 = Math.floor(x / RES) * RES
      const dX = (at(x + 1, y, tx0, ty0) - at(x - 1, y, tx0, ty0)) * STR
      const dY = (at(x, y + 1, tx0, ty0) - at(x, y - 1, tx0, ty0)) * STR
      const inv = 1 / Math.hypot(dX, dY, 1)
      const i = (y * ATLAS_W + x) * 4
      o[i] = (-dX * inv * 0.5 + 0.5) * 255
      o[i + 1] = (dY * inv * 0.5 + 0.5) * 255
      o[i + 2] = (inv * 0.5 + 0.5) * 255
      o[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return cv
}

export function buildAtlas() {
  const diffCv = document.createElement('canvas')
  diffCv.width = ATLAS_W; diffCv.height = ATLAS_H
  const diff = diffCv.getContext('2d')
  const emisCv = document.createElement('canvas')
  emisCv.width = ATLAS_W; emisCv.height = ATLAS_H
  const emis = emisCv.getContext('2d')
  emis.fillStyle = '#000'
  emis.fillRect(0, 0, ATLAS_W, ATLAS_H)

  for (const slot of Object.values(TILES)) paintTile(diff, emis, slot)

  const mk = (cv, srgb) => {
    const tex = new THREE.CanvasTexture(cv)
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = 8
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }
  return {
    map: mk(diffCv, true),
    normal: mk(buildNormalCanvas(diffCv), false),
    emissive: mk(emisCv, true)
  }
}

export function tileUV(slot) {
  const col = slot % COLS
  const row = Math.floor(slot / COLS)
  // ~4px inset guards against mipmap bleeding between atlas neighbors
  const eu = 4 / ATLAS_W
  const ev = 4 / ATLAS_H
  const u0 = col / COLS + eu
  const u1 = (col + 1) / COLS - eu
  const v1 = 1 - (row / ROWS) - ev
  const v0 = 1 - ((row + 1) / ROWS) + ev
  return { u0, u1, v0, v1 }
}

// HUD swatch: render the real painter, smoothly downscaled
export function swatch(slot, size = 40) {
  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES
  const ctx = cv.getContext('2d')
  const img = ctx.createImageData(RES, RES)
  const d = img.data
  const painter = P[slot] || P[TILES.stone]
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    const c = painter(x / RES, y / RES, x, y)
    const i = (y * RES + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const out = document.createElement('canvas')
  out.width = size; out.height = size
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(cv, 0, 0, RES, RES, 0, 0, size, size)
  return out.toDataURL()
}
