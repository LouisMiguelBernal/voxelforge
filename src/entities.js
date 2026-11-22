import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Servo-skull companion + enemies — smooth-shaded models (spheres/cones),
// emissive eyes, squash-and-stretch animation, shadow casting.
// Interface: .group .alive .hp .maxHp .hurt(dmg,kb) .update(dt,player)->dist
// ---------------------------------------------------------------------------

const _head = new THREE.Vector3()
const _want = new THREE.Vector3()
const _dir = new THREE.Vector3()
const FLASH = new THREE.Color('#ffffff')
const NOFLASH = new THREE.Color('#000000')

function disposeGroup(root) {
  root.traverse(o => {
    if (o.isSprite) { o.material.dispose(); return }
    if (o.geometry) o.geometry.dispose()
    if (o.material) o.material.dispose()
  })
}

function enableShadows(root) {
  root.traverse(o => { if (o.isMesh) o.castShadow = true })
}

const eyeMat = (c) => new THREE.MeshStandardMaterial({ color: '#1a0505', emissive: c, emissiveIntensity: 3, roughness: 0.4 })

function makeSkull(color = '#cfc6b0', eyeColor = '#ff3020', scale = 1) {
  const g = new THREE.Group()
  const mats = []
  const bone = (c, r = 0.55) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 })
    mats.push(m); return m
  }
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.19 * scale, 18, 14), bone(color))
  cranium.scale.set(1, 0.88, 1.06)
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2 * scale, 0.09 * scale, 0.16 * scale), bone(color))
  jaw.position.set(0, -0.17 * scale, 0.04 * scale)
  const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.26 * scale, 0.08 * scale, 0.18 * scale), bone(color))
  cheek.position.set(0, -0.08 * scale, 0.03 * scale)
  const mkEye = (x) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045 * scale, 10, 8), eyeMat(eyeColor))
    e.position.set(x * scale, -0.01 * scale, 0.15 * scale)
    return e
  }
  g.add(cranium, jaw, cheek, mkEye(-0.08), mkEye(0.08))
  return { group: g, mats }
}

function makeHpBar(width = 0.9) {
  const holder = new THREE.Group()
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#0c0908', opacity: 0.75, transparent: true, depthTest: false }))
  bg.scale.set(width, 0.085, 1)
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#d33030', transparent: true, depthTest: false }))
  fg.center.set(0, 0.5)
  fg.position.x = -width * 0.48
  fg.scale.set(width * 0.96, 0.055, 1)
  bg.renderOrder = 18; fg.renderOrder = 19
  holder.add(bg, fg)
  holder.visible = false
  return { holder, fg, width }
}

// flash helper: pulse emissive white on hit (works with Standard materials)
function applyFlash(mats, on) {
  for (const m of mats) {
    if (!m._baseEmissive) m._baseEmissive = m.emissive.clone()
    m.emissive.copy(on ? FLASH : m._baseEmissive)
    m.emissiveIntensity = on ? 0.9 : (m._baseIntensity ?? m.emissiveIntensity)
  }
}

// ============================ SERVO-SKULL ==================================

export class ServoSkull {
  constructor(scene, def) {
    this.scene = scene
    this.def = def
    this.active = def && def.role !== 'none'
    this.group = new THREE.Group()
    this.t = 0
    this.cooldown = 0
    this.dismissed = false
    this._zapLine = null
    this._zapT = 0
    if (this.active) this._build(def.color)
  }

  _build(color) {
    const { group } = makeSkull('#d8d0bc', color, 1)
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: '#6a6255', metalness: 0.7, roughness: 0.4 }))
    ant.position.y = 0.26
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), eyeMat(color))
    tip.position.y = 0.38
    const glow = new THREE.PointLight(color, 0.9, 5)
    group.add(ant, tip, glow)
    enableShadows(group)
    this.group = group
    this.scene.add(this.group)

    const zg = new THREE.BufferGeometry()
    zg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this._zapLine = new THREE.Line(zg, new THREE.LineBasicMaterial({ color }))
    this._zapLine.frustumCulled = false
    this._zapLine.visible = false
    this.scene.add(this._zapLine)
  }

  _teardown() {
    if (this.group.parent) this.group.parent.remove(this.group)
    disposeGroup(this.group)
    if (this._zapLine) {
      this.scene.remove(this._zapLine)
      this._zapLine.geometry.dispose()
      this._zapLine.material.dispose()
      this._zapLine = null
    }
  }

  setDef(def) {
    this._teardown()
    this.group = new THREE.Group()
    this.def = def
    this.active = def && def.role !== 'none'
    this.t = 0
    if (this.active) {
      this._build(def.color)
      this.group.visible = !this.dismissed
    }
  }

  toggle() {
    this.dismissed = !this.dismissed
    this.group.visible = !this.dismissed && this.active
  }

  update(dt, player, enemies, onDamage, onHeal) {
    if (this._zapLine && this._zapT > 0) {
      this._zapT -= dt
      if (this._zapT <= 0) this._zapLine.visible = false
    }
    if (!this.active || this.dismissed) return
    this.t += dt
    const p = player.pos
    const tx = p.x - Math.sin(player.yaw) * 1.1 + Math.cos(player.yaw) * 0.6
    const tz = p.z - Math.cos(player.yaw) * 1.1 - Math.sin(player.yaw) * 0.6
    const ty = p.y + 1.75 + Math.sin(this.t * 2) * 0.12
    const k = Math.min(1, dt * 4)
    this.group.position.x += (tx - this.group.position.x) * k
    this.group.position.y += (ty - this.group.position.y) * k
    this.group.position.z += (tz - this.group.position.z) * k
    this.group.rotation.y = player.yaw + Math.sin(this.t) * 0.2
    this.group.rotation.z = Math.sin(this.t * 1.3) * 0.06     // gentle idle sway

    this.cooldown -= dt
    if (this.def.role === 'heal' && onHeal) {
      onHeal(this.def.rate * dt)
    } else if (this.def.role === 'combat' && this.cooldown <= 0) {
      let best = null, bd = 100
      for (const e of enemies) {
        if (!e.alive) continue
        const d = e.group.position.distanceToSquared(this.group.position)
        if (d < bd) { bd = d; best = e }
      }
      if (best) {
        onDamage(best, this.def.dps * 0.6)
        this.cooldown = 0.6
        this._zap(best.group.position)
      }
    }
  }

  _zap(target) {
    if (!this._zapLine) return
    const a = this._zapLine.geometry.attributes.position.array
    a[0] = this.group.position.x; a[1] = this.group.position.y; a[2] = this.group.position.z
    a[3] = target.x; a[4] = target.y; a[5] = target.z
    this._zapLine.geometry.attributes.position.needsUpdate = true
    this._zapLine.visible = true
    this._zapT = 0.09
  }
}

// ============================ PLAGUE SLIME =================================

export class Slime {
  constructor(scene, world, pos) {
    this.scene = scene
    this.world = world
    this.alive = true
    this.maxHp = 26
    this.hp = this.maxHp
    this.hurtT = 0
    this.vy = 0
    this.hvx = 0
    this.hvz = 0
    this.hopCd = Math.random() * 1.5
    this.kb = new THREE.Vector3()
    this.gooColors = ['#5a7a20', '#7a9a30', '#3d5a14']

    this.group = new THREE.Group()
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: '#55761f', roughness: 0.28, metalness: 0,
      transparent: true, opacity: 0.92,
      emissive: '#1c2e08', emissiveIntensity: 0.5
    })
    this.bodyMat._baseEmissive = new THREE.Color('#1c2e08')
    this.bodyMat._baseIntensity = 0.5
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 22, 16), this.bodyMat)
    this.body.scale.set(1, 0.72, 1)
    this.body.position.y = 0.1
    const mkEye = (x) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), eyeMat('#ff3020'))
      e.position.set(x, 0.18, 0.38); return e
    }
    const mkHorn = (x) => {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8),
        new THREE.MeshStandardMaterial({ color: '#cbc0a2', roughness: 0.5 }))
      h.position.set(x, 0.42, 0.05); h.rotation.z = -x * 1.2; return h
    }
    this.group.add(this.body, mkEye(-0.16), mkEye(0.16), mkHorn(-0.24), mkHorn(0.24))
    enableShadows(this.group)

    const bar = makeHpBar(0.9)
    bar.holder.position.y = 0.8
    this.group.add(bar.holder)
    this.bar = bar

    this.group.position.copy(pos)
    scene.add(this.group)
  }

  hurt(dmg, kbVec) {
    if (!this.alive) return
    this.hp -= dmg
    this.hurtT = 0.15
    if (kbVec) this.kb.add(kbVec)
    if (this.hp <= 0) this.die()
  }

  die() {
    this.alive = false
    this.scene.remove(this.group)
    disposeGroup(this.group)
  }

  update(dt, player) {
    if (!this.alive) return Infinity
    this.hurtT -= dt
    applyFlash([this.bodyMat], this.hurtT > 0)

    this.group.position.addScaledVector(this.kb, dt)
    this.kb.multiplyScalar(Math.exp(-5 * dt))

    const p = player.pos
    const dx = p.x - this.group.position.x
    const dz = p.z - this.group.position.z
    const dist = Math.hypot(dx, dz)
    const gy = this.world.groundYBelow(
      Math.floor(this.group.position.x), Math.floor(this.group.position.z),
      this.group.position.y + 0.5)

    this.hopCd -= dt
    const grounded = this.group.position.y <= gy + 0.01
    if (grounded && this.hopCd <= 0 && dist < 17) {
      this.vy = 5.4
      const inv = 1 / (dist || 1)
      this.hvx = dx * inv * 3.0
      this.hvz = dz * inv * 3.0
      this.hopCd = 0.85 + Math.random() * 0.55
    }
    this.vy += -18 * dt
    this.group.position.y += this.vy * dt
    if (!grounded) {
      this.group.position.x += this.hvx * dt
      this.group.position.z += this.hvz * dt
    }
    if (this.group.position.y < gy) {
      this.group.position.y = gy
      this.vy = 0; this.hvx = 0; this.hvz = 0
    }

    // squash & stretch: stretch tall in the air, squash wide on the ground
    const ty = grounded ? 0.72 : 0.95
    const k = Math.min(1, dt * (grounded ? 10 : 6))
    this.body.scale.y += (ty - this.body.scale.y) * k
    const xz = 1.7 - this.body.scale.y                        // volume-ish preservation
    this.body.scale.x = this.body.scale.z = 0.55 + xz * 0.45

    this.group.lookAt(p.x, this.group.position.y, p.z)
    this.bar.holder.quaternion.copy(this.group.quaternion).invert()

    this.bar.holder.visible = this.hp < this.maxHp
    if (this.bar.holder.visible) this.bar.fg.scale.x = this.bar.width * 0.96 * Math.max(0, this.hp / this.maxHp)

    const top = this.group.position.y + 0.4
    const bottom = this.group.position.y - 0.2
    const dy = Math.max(0, p.y - top, bottom - (p.y + 1.8))
    return Math.hypot(dx, dz, dy)
  }
}

// ============================ VEX SKULL (flyer) ============================

export class VexSkull {
  constructor(scene, world, pos) {
    this.scene = scene
    this.world = world
    this.alive = true
    this.maxHp = 14
    this.hp = this.maxHp
    this.hurtT = 0
    this.hitCd = 0
    this.mode = 'orbit'
    this.ang = Math.random() * Math.PI * 2
    this.diveT = 2.5 + Math.random() * 3
    this.diveTimer = 0
    this.t = Math.random() * 10
    this.gooColors = ['#c4b998', '#8a8070', '#ff3020']

    const { group: skull, mats } = makeSkull('#c8bd9f', '#ff3020', 1.4)
    this.mats = mats
    const mkHorn = (x) => {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 8),
        new THREE.MeshStandardMaterial({ color: '#57503f', metalness: 0.3, roughness: 0.6 }))
      h.position.set(x, 0.26, 0); h.rotation.z = -x * 1.6; return h
    }
    skull.add(mkHorn(-0.16), mkHorn(0.16))
    enableShadows(skull)

    this.inner = skull
    this.group = new THREE.Group()
    this.group.add(skull)

    const bar = makeHpBar(0.8)
    bar.holder.position.y = 0.55
    this.group.add(bar.holder)
    this.bar = bar

    this.group.position.copy(pos)
    scene.add(this.group)
  }

  hurt(dmg, kbVec) {
    if (!this.alive) return
    this.hp -= dmg
    this.hurtT = 0.15
    if (kbVec) this.group.position.addScaledVector(kbVec, 0.12)
    if (this.hp <= 0) this.die()
  }

  die() {
    this.alive = false
    this.scene.remove(this.group)
    disposeGroup(this.group)
  }

  update(dt, player) {
    if (!this.alive) return Infinity
    this.t += dt
    this.hurtT -= dt
    this.hitCd -= dt
    applyFlash(this.mats, this.hurtT > 0)

    _head.copy(player.pos); _head.y += 1.4
    const pos = this.group.position

    if (this.mode === 'orbit') {
      this.ang += dt * 0.75
      const gy = this.world.groundYBelow(Math.floor(player.pos.x), Math.floor(player.pos.z), player.pos.y + 2)
      _want.set(
        player.pos.x + Math.cos(this.ang) * 6.5,
        Math.max(gy, player.pos.y) + 3.4 + Math.sin(this.t * 2) * 0.4,
        player.pos.z + Math.sin(this.ang) * 6.5
      )
      pos.lerp(_want, Math.min(1, dt * 2))
      this.diveT -= dt
      if (this.diveT <= 0) { this.mode = 'dive'; this.diveTimer = 0 }
    } else if (this.mode === 'dive') {
      this.diveTimer += dt
      _dir.copy(_head).sub(pos).normalize()
      pos.addScaledVector(_dir, 10 * dt)
      if (pos.distanceTo(_head) < 0.9 || this.diveTimer > 1.5) this.mode = 'recover'
    } else {
      pos.y += 4 * dt
      if (pos.y > _head.y + 3) { this.mode = 'orbit'; this.diveT = 2.8 + Math.random() * 3 }
    }

    this.group.lookAt(_head)
    this.inner.rotation.z = Math.sin(this.t * 4) * 0.1
    // menace: jaw-forward tilt during the dive
    this.inner.rotation.x += ((this.mode === 'dive' ? 0.35 : 0) - this.inner.rotation.x) * Math.min(1, dt * 6)
    this.bar.holder.quaternion.copy(this.group.quaternion).invert()

    this.bar.holder.visible = this.hp < this.maxHp
    if (this.bar.holder.visible) this.bar.fg.scale.x = this.bar.width * 0.96 * Math.max(0, this.hp / this.maxHp)

    return pos.distanceTo(_head)
  }
}
