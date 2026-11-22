import * as THREE from 'three'
import { BLOCKS, tileUV } from './textures.js'

// ---------------------------------------------------------------------------
// Voxel world: flat Uint8 grid, chunked meshing. Only exposed faces are
// emitted, with per-vertex ambient occlusion baked into vertex colors —
// corners and crevices self-shade, which reads as smooth global lighting.
// ---------------------------------------------------------------------------

export const WX = 64
export const WZ = 64
export const WY = 40
export const CH = 16

const FACES = [
  { n: [1, 0, 0], c: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },   // +x
  { n: [-1,0, 0], c: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },   // -x
  { n: [0, 1, 0], c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },   // +y
  { n: [0,-1, 0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },   // -y
  { n: [0, 0, 1], c: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },   // +z
  { n: [0, 0,-1], c: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }    // -z
]

// brightness per AO level (0 = fully occluded corner, 3 = open)
const AO_LEVELS = [0.42, 0.65, 0.84, 1.0]

export class World {
  constructor(maps) {
    this.data = new Uint8Array(WX * WY * WZ)
    this.group = new THREE.Group()
    this.material = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.65, 0.65),
      emissiveMap: maps.emissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 1.4,
      roughness: 0.94,
      metalness: 0.03,
      vertexColors: true
    })
    this.chunks = new Map()
    this.generate()
    this.buildAll()
  }

  idx(x, y, z) { return x + z * WX + y * WX * WZ }
  inBounds(x, y, z) { return x >= 0 && x < WX && y >= 0 && y < WY && z >= 0 && z < WZ }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0
    return this.data[this.idx(x, y, z)]
  }
  set(x, y, z, v) {
    if (!this.inBounds(x, y, z)) return
    this.data[this.idx(x, y, z)] = v
  }
  solid(x, y, z) { return this.get(x, y, z) !== 0 }

  // ---- terrain generation ----
  generate() {
    const noise = (x, z) => {
      let n = 0
      n += Math.sin(x * 0.14) * Math.cos(z * 0.11) * 3.2
      n += Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.06 + 0.4) * 5.5
      n += Math.sin((x + z) * 0.09) * 2.0
      return n
    }
    const base = 14
    const water = 12
    for (let x = 0; x < WX; x++) {
      for (let z = 0; z < WZ; z++) {
        let hgt = Math.round(base + noise(x, z))
        hgt = Math.max(4, Math.min(WY - 8, hgt))
        for (let y = 0; y <= hgt; y++) {
          let block
          if (y === hgt) block = hgt <= water + 1 ? 6 /*ash*/ : 1 /*grass*/
          else if (y > hgt - 3) block = hgt <= water + 1 ? 6 : 2 /*dirt*/
          else block = 3 /*stone*/
          if (block === 3 && y < 11 && this.hashChance(x * 13 + y * 7, z * 17 + y * 3, 0.02)) block = 15
          this.set(x, y, z, block)
        }
        const top = this.get(x, hgt, z)
        if (top === 1 && this.hashChance(x, z, 0.03)) {
          this.plantTree(x, hgt + 1, z)
        } else if (top === 1 && this.hashChance(x * 3 + 7, z * 5 + 11, 0.004)) {
          this.buildRuin(x, hgt + 1, z)
        } else if (this.hashChance(x * 9 + 1, z * 2 + 3, 0.006)) {
          this.set(x, hgt, z, 13)
        }
      }
    }
  }

  buildRuin(x, y, z) {
    const height = 3 + Math.floor(this.hashChance(x, z, 0.5) ? 2 : 0) + (this.hashChance(z, x, 0.5) ? 1 : 0)
    for (let i = 0; i < height; i++) this.set(x, y + i, z, 16)
    if (this.hashChance(x + z, x - z, 0.4)) this.set(x, y + height, z, 13)
  }

  hashChance(x, z, p) {
    let n = Math.sin(x * 91.3 + z * 47.7) * 12543.21
    return (n - Math.floor(n)) < p
  }

  plantTree(x, y, z) {
    const th = 4
    for (let i = 0; i < th; i++) this.set(x, y + i, z, 4)
    const top = y + th
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -1; dy <= 1; dy++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue
          const lx = x + dx, ly = top + dy, lz = z + dz
          if (this.get(lx, ly, lz) === 0) this.set(lx, ly, lz, 5)
        }
    this.set(x, top + 1, z, 5)
  }

  // ---- meshing ----
  chunkKey(cx, cz) { return cx + ',' + cz }

  buildAll() {
    for (let cx = 0; cx < WX / CH; cx++)
      for (let cz = 0; cz < WZ / CH; cz++)
        this.buildChunk(cx, cz)
  }

  // AO for one face corner: side/side/diagonal neighbor test
  _cornerAO(x, y, z, n, corner) {
    // the two axes perpendicular to the face normal
    const axes = []
    for (let a = 0; a < 3; a++) if (n[a] === 0) axes.push(a)
    const [a1, a2] = axes
    const o1 = corner[a1] ? 1 : -1
    const o2 = corner[a2] ? 1 : -1
    const base = [x + n[0], y + n[1], z + n[2]]
    const s1p = [...base]; s1p[a1] += o1
    const s2p = [...base]; s2p[a2] += o2
    const cp = [...base]; cp[a1] += o1; cp[a2] += o2
    const s1 = this.solid(s1p[0], s1p[1], s1p[2]) ? 1 : 0
    const s2 = this.solid(s2p[0], s2p[1], s2p[2]) ? 1 : 0
    if (s1 && s2) return 0
    const c = this.solid(cp[0], cp[1], cp[2]) ? 1 : 0
    return 3 - (s1 + s2 + c)
  }

  buildChunk(cx, cz) {
    const key = this.chunkKey(cx, cz)
    const positions = [], normals = [], uvs = [], colors = [], indices = []
    let vc = 0
    const x0 = cx * CH, z0 = cz * CH

    for (let x = x0; x < x0 + CH; x++) {
      for (let z = z0; z < z0 + CH; z++) {
        for (let y = 0; y < WY; y++) {
          const b = this.get(x, y, z)
          if (b === 0) continue
          const def = BLOCKS[b]
          for (let f = 0; f < 6; f++) {
            const nb = FACES[f].n
            if (this.solid(x + nb[0], y + nb[1], z + nb[2])) continue
            const uv = tileUV(def.faces[f])
            const c = FACES[f].c
            const uvCorners = [
              [uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]
            ]
            const ao = []
            for (let k = 0; k < 4; k++) {
              positions.push(x + c[k][0], y + c[k][1], z + c[k][2])
              normals.push(nb[0], nb[1], nb[2])
              uvs.push(uvCorners[k][0], uvCorners[k][1])
              const lvl = this._cornerAO(x, y, z, nb, c[k])
              ao.push(lvl)
              const br = AO_LEVELS[lvl]
              colors.push(br, br, br)
            }
            // flip the quad diagonal so AO interpolates without artifacts
            if (ao[0] + ao[2] < ao[1] + ao[3]) {
              indices.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc)
            } else {
              indices.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3)
            }
            vc += 4
          }
        }
      }
    }

    let mesh = this.chunks.get(key)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)

    if (mesh) {
      mesh.geometry.dispose()
      mesh.geometry = geo
    } else {
      mesh = new THREE.Mesh(geo, this.material)
      mesh.frustumCulled = true
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.chunks.set(key, mesh)
      this.group.add(mesh)
    }
  }

  rebuildAround(x, z) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH)
    const done = new Set()
    const doIt = (a, b) => {
      if (a < 0 || b < 0 || a >= WX / CH || b >= WZ / CH) return
      const k = a + ',' + b
      if (done.has(k)) return
      done.add(k); this.buildChunk(a, b)
    }
    doIt(cx, cz)
    // AO reaches one block across chunk borders, so rebuild neighbors when
    // the edit is within 1 block of a boundary (not only exactly on it)
    if (x % CH <= 1) doIt(cx - 1, cz)
    if (x % CH >= CH - 2) doIt(cx + 1, cz)
    if (z % CH <= 1) doIt(cx, cz - 1)
    if (z % CH >= CH - 2) doIt(cx, cz + 1)
  }

  surfaceY(x, z) {
    for (let y = WY - 1; y >= 0; y--) if (this.solid(x, y, z)) return y + 1
    return WY / 2
  }

  groundYBelow(x, z, fromY) {
    for (let y = Math.min(Math.floor(fromY), WY - 1); y >= 0; y--)
      if (this.solid(x, y, z)) return y + 1
    return 0
  }
}
