import * as THREE from 'three'
import { CATALOG } from './loadout.js'

// ---------------------------------------------------------------------------
// AABB voxel player. Movement is camera-relative (proper yaw rotation of the
// input vector), with acceleration curves, sprint + FOV kick, coyote time,
// jump buffering, landing dip, strafe roll, weapon sway and a keyframed
// anticipation/strike/recover swing animation.
// ---------------------------------------------------------------------------

const P_HALF = 0.3
const P_HEIGHT = 1.8
const EYE = 1.62
const GRAVITY = -24
const JUMP = 8.6
const COYOTE = 0.12
const JUMP_BUFFER = 0.14
const BASE_FOV = 74
const SPRINT_FOV = 82

const easeOutQuad = (t) => t * (2 - t)
const easeInQuad = (t) => t * t
const easeInOutQuad = (t) => t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2

// swing timeline: wind-up (negative), fast strike to 1, smooth recover to 0
function swingCurve(t) {
  if (t < 0.18) return -0.35 * easeOutQuad(t / 0.18)
  if (t < 0.42) return -0.35 + 1.35 * easeInQuad((t - 0.18) / 0.24)
  return 1 - easeInOutQuad((t - 0.42) / 0.58)
}

export class Player {
  constructor(camera, world) {
    this.cam = camera
    this.world = world
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.yaw = 0
    this.pitch = 0
    this.onGround = false
    this.speed = 4.3
    this.attackSpeed = 1

    this.keys = {}
    this.swing = 0
    this.swinging = false

    this._coyoteT = -1
    this._jumpQueuedT = -1
    this._t = 0
    this._dip = 0
    this._roll = 0
    this._swayX = 0
    this._swayY = 0
    this._stepAcc = 0
    this.sprinting = false

    this.onStep = null
    this.onJump = null
    this.onLand = null

    this._buildViewmodel()
    this.spawn()
  }

  spawn() {
    const x = 32, z = 32
    const y = this.world.surfaceY(x, z) + 1
    this.pos.set(x + 0.5, y, z + 0.5)
    this.vel.set(0, 0, 0)
  }

  // ---------- first-person weapon viewmodel ----------
  _buildViewmodel() {
    this.vm = new THREE.Group()
    this.vmPivot = new THREE.Group()
    this.vmPivot.add(this.vm)
    this.vmPivot.position.set(0.42, -0.42, -0.75)
    this.cam.add(this.vmPivot)
    this.glowLight = null
    this.setWeapon(CATALOG.weapon[0])
  }

  setWeapon(w) {
    for (const c of this.vm.children) {
      if (c.geometry) c.geometry.dispose()
      if (c.material) c.material.dispose()
    }
    this.vm.clear()
    if (this.glowLight) { this.vmPivot.remove(this.glowLight); this.glowLight = null }
    this.weaponDef = w

    const metal = (c, r = 0.32) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.85, roughness: r })
    const matte = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.15, roughness: 0.85 })
    const glow = (c) => new THREE.MeshStandardMaterial({ color: '#0a0a0a', emissive: c, emissiveIntensity: 2.6, roughness: 0.4 })
    const add = (geo, m, x, y, z, rz = 0) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      if (rz) mesh.rotation.z = rz
      this.vm.add(mesh)
      return mesh
    }
    const box = (a, b, c) => new THREE.BoxGeometry(a, b, c)
    const cyl = (r, h, s = 12) => new THREE.CylinderGeometry(r, r, h, s)

    if (w.shape === 'chain') {
      add(box(0.1, 0.62, 0.05), metal('#4a505c', 0.45), 0, 0.26, 0)          // casing
      add(box(0.045, 0.64, 0.06), metal('#d5dae2', 0.2), 0.055, 0.26, 0)     // blade edge
      for (let i = 0; i < 6; i++) add(box(0.035, 0.045, 0.065), metal('#eef1f5', 0.15), 0.09, 0.02 + i * 0.105, 0)
      add(box(0.13, 0.12, 0.09), matte(w.trim), 0, -0.08, 0)                 // housing
      add(cyl(0.032, 0.22), matte('#241812'), 0, -0.24, 0)                   // grip
    } else if (w.shape === 'sword') {
      add(box(0.05, 0.76, 0.05), glow(w.color), 0, 0.31, 0)                  // energized blade
      add(box(0.075, 0.76, 0.018), glow('#eaf7ff'), 0, 0.31, 0)              // core shimmer
      add(box(0.27, 0.05, 0.09), metal('#a8863c', 0.35), 0, -0.08, 0)        // brass guard
      add(cyl(0.03, 0.2), matte('#241812'), 0, -0.22, 0)
      add(new THREE.SphereGeometry(0.045, 10, 8), metal('#a8863c'), 0, -0.34, 0) // pommel
    } else if (w.shape === 'hammer') {
      add(cyl(0.028, 0.76), matte(w.trim), 0, 0.06, 0)                       // long haft
      add(box(0.3, 0.22, 0.2), metal('#5c564c', 0.4), 0, 0.44, 0)            // head
      add(box(0.32, 0.05, 0.22), glow(w.color), 0, 0.53, 0)                  // charged cap
      add(cyl(0.05, 0.09), metal('#a8863c'), 0, 0.31, 0)                     // brass collar
    } else if (w.shape === 'fist') {
      add(box(0.26, 0.24, 0.3), metal(w.color, 0.35), 0, 0, 0)               // gauntlet
      add(box(0.28, 0.07, 0.1), glow(w.glow || '#7ab0ff'), 0, 0.1, 0.1)      // power coils
      for (let i = 0; i < 3; i++) add(box(0.05, 0.05, 0.05), metal('#c9ccd6', 0.25), -0.08 + i * 0.08, 0.145, 0.12)
    } else if (w.shape === 'pick') {
      add(cyl(0.028, 0.64), matte(w.trim), 0, 0.02, 0)
      const cres = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.045, 8, 14, Math.PI),
        metal(w.color, 0.3))
      cres.position.set(0, 0.3, 0); cres.rotation.z = Math.PI
      this.vm.add(cres)
      add(cyl(0.05, 0.1), metal('#a8863c'), 0, 0.32, 0)                      // brass boss
    }

    if (w.glow) {
      this.glowLight = new THREE.PointLight(w.glow, 1.1, 3.2)
      this.glowLight.position.set(0, 0.3, 0)
      this.vmPivot.add(this.glowLight)
    }
    this.vm.rotation.set(0.1, 0.3, 0.1)
  }

  triggerSwing() {
    if (this.swinging) return false
    this.swinging = true
    this.swing = 0
    return true
  }

  // ---------- input wiring ----------
  bind(dom) {
    this._down = (e) => {
      this.keys[e.code] = true
      if (e.code === 'Space') this._jumpQueuedT = this._t
    }
    this._up = (e) => { this.keys[e.code] = false }
    window.addEventListener('keydown', this._down)
    window.addEventListener('keyup', this._up)

    this._mouse = (e) => {
      if (document.pointerLockElement !== dom) return
      this.yaw -= e.movementX * 0.0022
      this.pitch -= e.movementY * 0.0022
      const lim = Math.PI / 2 - 0.05
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch))
      this._swayX = Math.max(-30, Math.min(30, this._swayX + e.movementX))
      this._swayY = Math.max(-30, Math.min(30, this._swayY + e.movementY))
    }
    document.addEventListener('mousemove', this._mouse)
  }

  // ---------- physics ----------
  collides(px, py, pz) {
    const minX = Math.floor(px - P_HALF), maxX = Math.floor(px + P_HALF)
    const minY = Math.floor(py), maxY = Math.floor(py + P_HEIGHT)
    const minZ = Math.floor(pz - P_HALF), maxZ = Math.floor(pz + P_HALF)
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (this.world.solid(x, y, z)) return true
    return false
  }

  update(dt, active) {
    this._t += dt

    // ----- wish direction (camera-relative) -----
    let ix = 0, iz = 0
    if (active) {
      if (this.keys['KeyW']) iz -= 1
      if (this.keys['KeyS']) iz += 1
      if (this.keys['KeyA']) ix -= 1
      if (this.keys['KeyD']) ix += 1
    }
    const len = Math.hypot(ix, iz) || 1
    const nix = ix / len, niz = iz / len
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw)
    // rotate the local input vector by yaw: camera forward is (-sin, -cos),
    // camera right is (cos, -sin) — W must always move where you look
    const wx = nix * cos + niz * sin
    const wz = niz * cos - nix * sin

    this.sprinting = active && (this.keys['ShiftLeft'] || this.keys['ShiftRight']) && niz < -0.1
    const targetSpeed = this.speed * (this.sprinting ? 1.5 : 1)

    const accel = this.onGround ? 13 : 3.5
    const k = 1 - Math.exp(-accel * dt)
    this.vel.x += (wx * targetSpeed - this.vel.x) * k
    this.vel.z += (wz * targetSpeed - this.vel.z) * k

    // ----- coyote time + jump buffer -----
    if (this.onGround) this._coyoteT = this._t
    const canJump = (this._t - this._coyoteT) < COYOTE
    const wantsJump = active && (this._t - this._jumpQueuedT) < JUMP_BUFFER
    if (wantsJump && canJump && this.vel.y <= 0.01) {
      this.vel.y = JUMP
      this.onGround = false
      this._coyoteT = -1
      this._jumpQueuedT = -1
      if (this.onJump) this.onJump()
    }
    this.vel.y += GRAVITY * dt

    // ----- integrate per axis -----
    const p = this.pos
    const wasGround = this.onGround
    const fallSpeed = -this.vel.y

    let nx = p.x + this.vel.x * dt
    if (!this.collides(nx, p.y, p.z)) p.x = nx; else this.vel.x = 0
    let nz = p.z + this.vel.z * dt
    if (!this.collides(p.x, p.y, nz)) p.z = nz; else this.vel.z = 0
    let ny = p.y + this.vel.y * dt
    if (!this.collides(p.x, ny, p.z)) {
      p.y = ny
      this.onGround = false
    } else {
      if (this.vel.y < 0) {
        this.onGround = true
        if (!wasGround && fallSpeed > 5) {
          this._dip = Math.min(0.35, fallSpeed * 0.028)
          if (this.onLand) this.onLand(fallSpeed)
        }
      }
      this.vel.y = 0
    }

    if (p.y < -5) this.spawn()

    // ----- footsteps -----
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    if (this.onGround && hSpeed > 1) {
      this._stepAcc += hSpeed * dt
      if (this._stepAcc > 2.3) {
        this._stepAcc = 0
        if (this.onStep) this.onStep()
      }
    }

    // ----- camera: dip, roll, bob, FOV -----
    this._dip *= Math.exp(-6 * dt)
    const targetRoll = -nix * 0.028
    this._roll += (targetRoll - this._roll) * Math.min(1, dt * 8)

    const moving = active && hSpeed > 0.5 && this.onGround
    this._bobT = (this._bobT || 0) + dt * (moving ? (this.sprinting ? 12 : 9) : 3)
    const bobY = moving ? Math.sin(this._bobT * 2) * 0.02 : Math.sin(this._bobT) * 0.004
    const bobX = moving ? Math.sin(this._bobT) * 0.011 : 0

    // swing state (needed for the camera kick below)
    if (this.swinging) {
      this.swing += dt * 3.4 * this.attackSpeed
      if (this.swing >= 1) { this.swing = 0; this.swinging = false }
    }
    const sw = this.swinging ? swingCurve(this.swing) : 0
    const strike = Math.max(0, sw)

    this.cam.position.set(p.x, p.y + EYE - this._dip + bobY, p.z)
    this.cam.rotation.order = 'YXZ'
    this.cam.rotation.y = this.yaw
    this.cam.rotation.x = this.pitch - strike * 0.014   // subtle strike kick
    this.cam.rotation.z = this._roll

    const tf = this.sprinting && moving ? SPRINT_FOV : BASE_FOV
    if (Math.abs(this.cam.fov - tf) > 0.05) {
      this.cam.fov += (tf - this.cam.fov) * Math.min(1, dt * 7)
      this.cam.updateProjectionMatrix()
    }

    // ----- weapon sway + swing pose -----
    this._swayX *= Math.exp(-8 * dt)
    this._swayY *= Math.exp(-8 * dt)
    const breathe = Math.sin(this._t * 1.7) * 0.006

    let vib = 0
    if (this.swinging && this.weaponDef && this.weaponDef.shape === 'chain') vib = (Math.random() - 0.5) * 0.018

    this.vmPivot.position.set(
      0.42 + bobX - this._swayX * 0.0007 + vib,
      -0.42 + bobY * 1.6 + breathe - this._swayY * 0.0005,
      -0.75 - strike * 0.26                              // lunge on the strike
    )
    this.vmPivot.rotation.set(-this._swayY * 0.0012, -this._swayX * 0.0015, 0)
    this.vm.rotation.set(0.1 - sw * 1.85, 0.3 - strike * 0.55, 0.1 + sw * 0.3)
  }

  dispose() {
    window.removeEventListener('keydown', this._down)
    window.removeEventListener('keyup', this._up)
    document.removeEventListener('mousemove', this._mouse)
  }
}
