import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Game-feel toolkit: instanced voxel particles, screen shake, hit-stop,
// floating damage numbers, slash arcs. One InstancedMesh = one draw call.
// ---------------------------------------------------------------------------

const MAXP = 384

export class Effects {
  constructor(scene, camera) {
    this.scene = scene
    this.camera = camera

    // --- rounded particles (unlit; bright ones bloom into sparks/embers) ---
    const geo = new THREE.IcosahedronGeometry(0.7, 1)
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAXP)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    scene.add(this.mesh)

    this.parts = new Array(MAXP)
    for (let i = 0; i < MAXP; i++) this.parts[i] = { on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 0.1, grav: 1 }
    this._m4 = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._s = new THREE.Vector3()
    this._c = new THREE.Color()
    this._cursor = 0

    // --- screen shake / hit-stop ---
    this.shakeAmp = 0
    this.hitstop = 0

    // --- damage numbers (pooled sprites) ---
    this.dn = []
    for (let i = 0; i < 14; i++) {
      const cv = document.createElement('canvas')
      cv.width = 192; cv.height = 72
      const tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      sp.scale.set(1.15, 0.43, 1)
      sp.renderOrder = 20
      sp.visible = false
      scene.add(sp)
      this.dn.push({ sp, cv, tex, life: 0, vy: 0 })
    }

    // --- slash arcs (pooled camera-space quads) ---
    this.slashes = []
    const slashTex = this._makeSlashTex()
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ map: slashTex, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false })
      )
      m.position.set(0, -0.05, -1.5)
      m.renderOrder = 15
      m.visible = false
      camera.add(m)
      this.slashes.push({ m, life: 0 })
    }
  }

  _makeSlashTex() {
    const cv = document.createElement('canvas')
    cv.width = 256; cv.height = 256
    const ctx = cv.getContext('2d')
    ctx.strokeStyle = '#ffffff'
    ctx.lineCap = 'round'
    ctx.shadowColor = '#ffffff'
    ctx.shadowBlur = 14
    // layered crescent arcs — soft motion-trail look
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.85 - i * 0.2
      ctx.lineWidth = 16 - i * 3.5
      ctx.beginPath()
      ctx.arc(128, 176, 104 - i * 14, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // spawn n particles at pos; colors: array of hex strings sampled randomly
  burst(pos, colors, n = 10, spd = 3, opts = {}) {
    const { gravity = 1, size = [0.05, 0.13], life = [0.25, 0.7], up = 0.5 } = opts
    for (let i = 0; i < n; i++) {
      const pt = this.parts[this._cursor]
      this._cursor = (this._cursor + 1) % MAXP
      pt.on = true
      pt.p.copy(pos)
      pt.v.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2 + up, (Math.random() - 0.5) * 2).normalize().multiplyScalar(spd * (0.4 + Math.random() * 0.6))
      pt.max = pt.life = life[0] + Math.random() * (life[1] - life[0])
      pt.size = size[0] + Math.random() * (size[1] - size[0])
      pt.grav = gravity
      this._c.set(colors[(Math.random() * colors.length) | 0])
      this.mesh.setColorAt(this._cursor === 0 ? MAXP - 1 : this._cursor - 1, this._c)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  // single slow-rising ambient ember
  ember(pos) {
    const pt = this.parts[this._cursor]
    const idx = this._cursor
    this._cursor = (this._cursor + 1) % MAXP
    pt.on = true
    pt.p.copy(pos)
    pt.v.set((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3)
    pt.max = pt.life = 2 + Math.random() * 1.5
    pt.size = 0.04 + Math.random() * 0.05
    pt.grav = 0
    this._c.set(Math.random() < 0.6 ? '#ff7a20' : '#ffd23d')
    this.mesh.setColorAt(idx, this._c)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  damageNumber(pos, text, color = '#ffffff', big = false) {
    let slot = this.dn.find(d => d.life <= 0)
    if (!slot) slot = this.dn[0]
    const ctx = slot.cv.getContext('2d')
    ctx.clearRect(0, 0, 192, 72)
    ctx.font = `bold ${big ? 46 : 36}px Georgia, serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(text, 96, 36)
    ctx.fillStyle = color
    ctx.fillText(text, 96, 36)
    ctx.shadowBlur = 0
    slot.tex.needsUpdate = true
    slot.sp.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4))
    slot.sp.material.opacity = 1
    slot.sp.visible = true
    slot.life = 0.75
    slot.vy = 1.6
  }

  slash(color = '#ffffff') {
    let s = this.slashes.find(x => x.life <= 0) || this.slashes[0]
    s.life = 0.14
    s.m.visible = true
    s.m.material.color.set(color)
    s.m.material.opacity = 0.85
    s.m.rotation.z = Math.random() * Math.PI * 2
  }

  shake(a) { this.shakeAmp = Math.min(0.4, this.shakeAmp + a) }
  hitStop(t) { this.hitstop = Math.max(this.hitstop, t) }

  // world-time scale for this frame (hit-stop slows the world, not the camera)
  timeScale(dt) {
    if (this.hitstop > 0) { this.hitstop -= dt; return 0.12 }
    return 1
  }

  // camera-position jitter; call after player positions the camera
  applyShake(dt) {
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp * 0.35
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.35
      this.camera.rotation.z += (Math.random() - 0.5) * this.shakeAmp * 0.05
      this.shakeAmp *= Math.exp(-9 * dt)
    } else this.shakeAmp = 0
  }

  update(dt) {
    // particles
    for (let i = 0; i < MAXP; i++) {
      const pt = this.parts[i]
      if (pt.on) {
        pt.life -= dt
        if (pt.life <= 0) pt.on = false
        else {
          pt.v.y -= 14 * pt.grav * dt
          pt.p.addScaledVector(pt.v, dt)
          pt.v.multiplyScalar(Math.exp(-1.5 * dt))
        }
      }
      const sc = pt.on ? pt.size * Math.min(1, pt.life / pt.max * 2.5) : 0
      this._s.set(sc, sc, sc)
      this._m4.compose(pt.p, this._q, this._s)
      this.mesh.setMatrixAt(i, this._m4)
    }
    this.mesh.instanceMatrix.needsUpdate = true

    // damage numbers
    for (const d of this.dn) {
      if (d.life <= 0) continue
      d.life -= dt
      d.sp.position.y += d.vy * dt
      d.vy *= Math.exp(-2 * dt)
      d.sp.material.opacity = Math.min(1, d.life / 0.3)
      if (d.life <= 0) d.sp.visible = false
    }

    // slashes
    for (const s of this.slashes) {
      if (s.life <= 0) continue
      s.life -= dt
      s.m.material.opacity = Math.max(0, s.life / 0.14) * 0.85
      s.m.scale.setScalar(1 + (0.14 - s.life) * 4)
      if (s.life <= 0) s.m.visible = false
    }
  }
}
