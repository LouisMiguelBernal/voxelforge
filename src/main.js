import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { buildAtlas, BLOCK_COLORS } from './textures.js'
import { World, WX, WZ } from './world.js'
import { Player } from './player.js'
import { ServoSkull, Slime, VexSkull } from './entities.js'
import { Effects } from './effects.js'
import { Sound } from './audio.js'
import { UI } from './ui.js'
import { defaultLoadout, saveLoadout, pick, computeStats } from './loadout.js'

// ===========================================================================
// VoxelForge: Grimdark — orchestrator: scene, loop, raycast, combat, states.
// ===========================================================================

// clicks-to-break resistance per block id (mining power is stats.mine per hit)
const HARDNESS = {
  1: 1, 2: 1, 5: 0.8, 6: 1, 9: 0.6,
  4: 1.6, 7: 1.6, 13: 1.6,
  3: 2.2, 8: 2.2, 10: 2.2, 14: 2.2, 16: 2.2,
  11: 2.6, 15: 2.6,
  12: 3.6
}

class Game {
  constructor() {
    this.state = 'menu'
    this.load = defaultLoadout()
    this.stats = computeStats(this.load)
    this.hp = this.stats.maxHp
    this.kills = 0
    this.attackCd = 0
    this.hurtSndCd = 0
    this._mineKey = null
    this._mineHp = 0

    this.audio = new Sound()
    this._initThree()
    this._initWorld()
    this.effects = new Effects(this.scene, this.camera)
    this._initEntities()
    this.ui = new UI(this)
    this.ui.renderLoadHud(this.stats, this.load)
    this.ui.setKills(0)

    this._bindGlobal()
    this._resize()
    window.addEventListener('resize', () => this._resize())

    this.clock = new THREE.Clock()
    this.emberT = 0
    this._loop()
  }

  // ---------- scene: cinematic dusk ----------
  _initThree() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.28
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    document.getElementById('app').appendChild(this.renderer.domElement)
    this.dom = this.renderer.domElement

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog('#6b4a3e', 42, 130)

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.1, 500)
    this.scene.add(this.camera)

    // key: low golden-hour sun with soft shadows
    const sun = new THREE.DirectionalLight('#ffd9a0', 2.4)
    sun.position.set(128, 112, -16)
    sun.target.position.set(32, 12, 32)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -52; sc.right = 52; sc.top = 52; sc.bottom = -52
    sc.near = 10; sc.far = 300
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    this.scene.add(sun, sun.target)

    // fill: cool steel-blue sky vs warm ground bounce (the GoW palette)
    this.scene.add(new THREE.HemisphereLight('#8a9cc0', '#4a3a30', 0.7))
    this.scene.add(new THREE.AmbientLight('#5a5048', 0.62))
    // rim: ember backlight from the opposite horizon
    const rim = new THREE.DirectionalLight('#ff7a35', 0.5)
    rim.position.set(-60, 25, 90)
    this.scene.add(rim)

    // smooth dusk gradient sky dome
    const skyCv = document.createElement('canvas')
    skyCv.width = 2; skyCv.height = 256
    const sctx = skyCv.getContext('2d')
    const grad = sctx.createLinearGradient(0, 256, 0, 0)
    grad.addColorStop(0, '#c97a3a')     // molten horizon
    grad.addColorStop(0.25, '#8a5a4a')  // dusty rose
    grad.addColorStop(0.55, '#4a3a55')  // violet band
    grad.addColorStop(1, '#141a30')     // deep indigo zenith
    sctx.fillStyle = grad
    sctx.fillRect(0, 0, 2, 256)
    const skyTex = new THREE.CanvasTexture(skyCv)
    skyTex.colorSpace = THREE.SRGBColorSpace
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    )
    this.scene.add(sky)

    // sun disc: soft radial glow the bloom pass turns into a halo
    const sunCv = document.createElement('canvas')
    sunCv.width = 128; sunCv.height = 128
    const suctx = sunCv.getContext('2d')
    const sg = suctx.createRadialGradient(64, 64, 4, 64, 64, 64)
    sg.addColorStop(0, 'rgba(255,240,210,1)')
    sg.addColorStop(0.25, 'rgba(255,200,130,0.9)')
    sg.addColorStop(0.6, 'rgba(255,140,60,0.28)')
    sg.addColorStop(1, 'rgba(255,120,40,0)')
    suctx.fillStyle = sg
    suctx.fillRect(0, 0, 128, 128)
    const sunTex = new THREE.CanvasTexture(sunCv)
    sunTex.colorSpace = THREE.SRGBColorSpace
    const sunMat = new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false })
    sunMat.fog = false
    const sunSprite = new THREE.Sprite(sunMat)
    sunSprite.position.set(230, 205, -80)
    sunSprite.scale.set(120, 120, 1)
    this.scene.add(sunSprite)

    // pale moon opposite the sun
    const moonCv = document.createElement('canvas')
    moonCv.width = 64; moonCv.height = 64
    const mctx = moonCv.getContext('2d')
    const mg = mctx.createRadialGradient(28, 26, 4, 32, 32, 30)
    mg.addColorStop(0, '#e8ddc8')
    mg.addColorStop(0.75, '#b8ab92')
    mg.addColorStop(1, 'rgba(150,140,120,0)')
    mctx.fillStyle = mg
    mctx.beginPath(); mctx.arc(32, 32, 30, 0, Math.PI * 2); mctx.fill()
    const moonTex = new THREE.CanvasTexture(moonCv)
    moonTex.colorSpace = THREE.SRGBColorSpace
    const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false })
    moonMat.fog = false
    const moon = new THREE.Sprite(moonMat)
    moon.position.set(-190, 120, -200)
    moon.scale.set(30, 30, 1)
    this.scene.add(moon)

    // post: bloom for emissives/sun + tone-mapped output
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.82)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  _initWorld() {
    this.atlas = buildAtlas()
    this.atlas.map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.world = new World(this.atlas)
    this.scene.add(this.world.group)
    this.player = new Player(this.camera, this.world)
    this.player.setWeapon(pick('weapon', this.load.weapon))
    this.player.speed = this.stats.speed
    this.player.attackSpeed = this.stats.attackSpeed
    // movement feel -> sound hooks
    this.player.onStep = () => this.audio.step()
    this.player.onJump = () => this.audio.jump()
    this.player.onLand = (v) => {
      this.audio.land(v)
      const feet = this.player.pos.clone(); feet.y += 0.1
      this.effects.burst(feet, ['#8b867e', '#5d452c'], 6, 1.5, { up: 0.8, size: [0.04, 0.09], life: [0.2, 0.45] })
    }
  }

  _initEntities() {
    this.bot = new ServoSkull(this.scene, pick('bot', this.load.bot))
    this.enemies = []
    this.pickups = []
    this.spawnTimer = 0
    this._spawnEnemies(6)
  }

  _spawnEnemies(n) {
    for (let i = 0; i < n; i++) {
      let x, z, tries = 0
      do {
        x = 6 + Math.floor(Math.random() * (WX - 12))
        z = 6 + Math.floor(Math.random() * (WZ - 12))
        tries++
      } while (tries < 8 && Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 12)
      const y = this.world.surfaceY(x, z)
      const pos = new THREE.Vector3(x + 0.5, y, z + 0.5)
      if (Math.random() < 0.3) {
        pos.y += 4
        this.enemies.push(new VexSkull(this.scene, this.world, pos))
      } else {
        this.enemies.push(new Slime(this.scene, this.world, pos))
      }
    }
  }

  // ---------- state transitions ----------
  _lockPointer() {
    const p = this.dom.requestPointerLock()
    if (p && typeof p.catch === 'function') p.catch(() => { /* transient denial; user clicks again */ })
  }

  start() {
    this.audio.init()
    document.getElementById('startScreen').classList.remove('show')
    document.getElementById('hud').style.display = 'block'
    this.onLoadoutChange()
    // full refill only on a fresh deploy — the wargear menu (paused) is not a heal
    if (this.state === 'menu') this.hp = this.stats.maxHp
    this.state = 'playing'
    this._lockPointer()
  }
  resume() {
    document.getElementById('pauseScreen').classList.remove('show')
    this.state = 'playing'
    this._lockPointer()
  }
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    document.getElementById('pauseScreen').classList.add('show')
    if (document.pointerLockElement) document.exitPointerLock()
  }
  quit() {
    document.getElementById('pauseScreen').classList.remove('show')
    document.getElementById('hud').style.display = 'none'
    document.getElementById('startScreen').classList.add('show')
    this.state = 'menu'
  }

  onLoadoutChange() {
    this.stats = computeStats(this.load)
    saveLoadout(this.load)
    this.player.setWeapon(this.stats.weapon)
    this.player.speed = this.stats.speed
    this.player.attackSpeed = this.stats.attackSpeed
    this.bot.setDef(pick('bot', this.load.bot))
    this.hp = Math.min(this.hp, this.stats.maxHp)
    if (this.ui) this.ui.renderLoadHud(this.stats, this.load)
  }

  // ---------- input ----------
  _bindGlobal() {
    this.player.bind(this.dom)

    this.dom.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return
      if (document.pointerLockElement !== this.dom) { this._lockPointer(); return }
      if (e.button === 0) this._primary()
      else if (e.button === 2) this._place()
    })
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('wheel', (e) => {
      if (this.state === 'playing') this.ui.scroll(e.deltaY)
    }, { passive: true })

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pause()
      } else if (e.code === 'KeyC') {
        if (this.state === 'playing') {
          this.pause()
          document.getElementById('pauseScreen').classList.remove('show')
          document.getElementById('startScreen').classList.add('show')
        }
      } else if (e.code === 'KeyB') {
        this.bot.toggle()
        if (this.state === 'playing') this.ui.toast(this.bot.dismissed ? 'SERVO-SKULL DISMISSED' : 'SERVO-SKULL ACTIVE', 1200)
      } else if (e.code === 'KeyM') {
        const on = this.audio.toggle()
        if (this.ui) this.ui.toast(on ? 'VOX ON' : 'VOX SILENCED', 1200)
      } else if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5)) - 1
        if (n >= 0 && n < 8) this.ui.selectSlot(n)
      }
    })

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing') this.pause()
    })
  }

  // voxel DDA raycast; returns {hit, prev, dist} or null
  raycastVoxel(maxDist) {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    const o = this.camera.position
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z)
    const step = [Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z)]
    const tDelta = [Math.abs(1 / (dir.x || 1e-9)), Math.abs(1 / (dir.y || 1e-9)), Math.abs(1 / (dir.z || 1e-9))]
    const frac = (s, v) => s > 0 ? (Math.floor(v) + 1 - v) : (v - Math.floor(v))
    let tMax = [
      tDelta[0] * frac(step[0], o.x),
      tDelta[1] * frac(step[1], o.y),
      tDelta[2] * frac(step[2], o.z)
    ]
    let prev = [x, y, z]
    let t = 0
    for (let i = 0; i < 160; i++) {
      if (this.world.solid(x, y, z)) return { hit: [x, y, z], prev, dist: t }
      prev = [x, y, z]
      if (tMax[0] < tMax[1] && tMax[0] < tMax[2]) { x += step[0]; t = tMax[0]; tMax[0] += tDelta[0] }
      else if (tMax[1] < tMax[2]) { y += step[1]; t = tMax[1]; tMax[1] += tDelta[1] }
      else { z += step[2]; t = tMax[2]; tMax[2] += tDelta[2] }
      if (t > maxDist) break
    }
    return null
  }

  _hitPoint(dist) {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    return this.camera.position.clone().addScaledVector(dir, dist)
  }

  // ---------- combat + mining ----------
  _primary() {
    if (this.attackCd > 0) return
    this.attackCd = 0.55 / this.stats.attackSpeed
    this.player.triggerSwing()
    this.audio.swing(this.stats.attackSpeed)
    this.effects.slash(this.stats.weapon.glow || '#e8dcc0')

    // 1) enemy in reach with clear line of sight?
    const enemy = this._enemyInReach()
    if (enemy) {
      const eDist = enemy.group.position.distanceTo(this.camera.position)
      const wall = this.raycastVoxel(eDist)
      if (!wall) { this._strike(enemy); return }
      // a block is in the way — the swing hits the wall instead (falls through)
    }

    // 2) mine targeted block (hardness-gated)
    const r = this.raycastVoxel(6)
    if (!r) return
    const [x, y, z] = r.hit
    const block = this.world.get(x, y, z)
    const key = x + ',' + y + ',' + z
    if (this._mineKey !== key) {
      this._mineKey = key
      this._mineHp = HARDNESS[block] || 1
    }
    this._mineHp -= this.stats.mine
    const hitPt = this._hitPoint(Math.max(0.1, r.dist - 0.05))
    const col = BLOCK_COLORS[block] || '#888888'

    if (this._mineHp <= 0) {
      this.world.set(x, y, z, 0)
      this.world.rebuildAround(x, z)
      this._mineKey = null
      this.effects.burst(hitPt, [col, '#3a3a3a'], 14, 3, { up: 0.8 })
      this.audio.breakBlock()
      this.effects.shake(0.05)
    } else {
      this.effects.burst(hitPt, [col], 5, 2, { up: 0.5, size: [0.03, 0.08], life: [0.15, 0.35] })
      this.audio.crack()
    }
  }

  _strike(enemy) {
    const crit = Math.random() < this.stats.crit
    const dmg = Math.round(this.stats.damage * (crit ? 1.8 : 1))
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    dir.y = Math.max(0.15, dir.y + 0.3)
    const kb = dir.multiplyScalar(this.stats.kb)

    enemy.hurt(dmg, kb)
    this.effects.burst(enemy.group.position, enemy.gooColors, crit ? 16 : 10, 3.5, { up: 1 })
    this.effects.damageNumber(enemy.group.position, String(dmg) + (crit ? '!' : ''), crit ? '#ffd23d' : '#ffffff', crit)
    this.ui.hitmarker()
    this.audio.hit()
    this.effects.shake(crit ? 0.2 : 0.1)

    if (!enemy.alive) this._onKill(enemy)
  }

  _onKill(enemy) {
    this._needsFilter = true
    this.kills++
    this.ui.setKills(this.kills)
    this.audio.kill()
    this.effects.hitStop(0.09)
    this.effects.shake(0.18)
    this.effects.burst(enemy.group.position, enemy.gooColors.concat('#1a1a1a'), 26, 5, { up: 1.4 })
    // chance to drop a medi-pack
    const dropChance = enemy instanceof VexSkull ? 0.6 : 0.35
    if (Math.random() < dropChance) this._spawnPickup(enemy.group.position)
  }

  _spawnPickup(pos) {
    const g = new THREE.Group()
    // glowing life orb — the bloom pass gives it a natural halo
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 12),
      new THREE.MeshStandardMaterial({ color: '#300808', emissive: '#ff3838', emissiveIntensity: 2.6, roughness: 0.3 })
    )
    const cross = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.05),
      new THREE.MeshStandardMaterial({ color: '#f5f0e8', emissive: '#fff2e0', emissiveIntensity: 0.8, roughness: 0.4 })
    )
    const cross2 = cross.clone(); cross2.rotation.z = Math.PI / 2
    g.add(core, cross, cross2)
    g.position.copy(pos); g.position.y += 0.4
    this.scene.add(g)
    this.pickups.push({ g, t: 0, baseY: g.position.y })
  }

  _removePickup(i) {
    const pk = this.pickups[i]
    this.scene.remove(pk.g)
    pk.g.traverse(o => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) o.material.dispose()
    })
    this.pickups.splice(i, 1)
  }

  _place() {
    const r = this.raycastVoxel(6)
    if (!r || !r.prev) return
    const [x, y, z] = r.prev
    if (this.world.solid(x, y, z)) return
    const id = this.ui.selectedBlock()
    // tentatively place, then reject if it intersects the player AABB —
    // reuses the exact collision math so you can never wall yourself in
    this.world.set(x, y, z, id)
    const p = this.player.pos
    if (this.player.collides(p.x, p.y, p.z)) { this.world.set(x, y, z, 0); return }
    this.world.rebuildAround(x, z)
    this.audio.place()
    this.effects.burst(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), [BLOCK_COLORS[id] || '#888'], 5, 1.2, { up: 0.6, size: [0.03, 0.07], life: [0.15, 0.3] })
  }

  _enemyInReach() {
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir)
    const o = this.camera.position
    let best = null, bestT = this.stats.reach
    for (const e of this.enemies) {
      if (!e.alive) continue
      const to = e.group.position.clone().sub(o)
      const proj = to.dot(dir)
      if (proj < 0 || proj > this.stats.reach) continue
      const perp = to.clone().sub(dir.clone().multiplyScalar(proj)).length()
      if (perp < 1.0 && proj < bestT) { bestT = proj; best = e }
    }
    return best
  }

  heal(amt) { this.hp = Math.min(this.stats.maxHp, this.hp + amt) }

  damage(amt, discrete = false) {
    const dmg = Math.max(discrete ? 1 : 0.2 * amt, amt - this.stats.defense * 0.6)
    this.hp -= dmg
    this.ui.damageFlash(discrete ? 0.55 : Math.min(0.4, dmg * 0.1))
    if (this.hurtSndCd <= 0) { this.audio.hurt(); this.hurtSndCd = 0.6 }
    if (discrete) this.effects.shake(0.15)
    if (this.hp <= 0) this._die()
  }

  _die() {
    this.audio.die()
    this.ui.damageFlash(1)
    this.ui.toast('☠ YOU HAVE FALLEN — REDEPLOYED ☠', 2600)
    this.effects.burst(this.player.pos.clone().add(new THREE.Vector3(0, 1, 0)), ['#a01820', '#5c0e14'], 30, 5, { up: 1.5 })
    this.hp = this.stats.maxHp
    this.player.spawn()
  }

  // ---------- main loop ----------
  _loop() {
    requestAnimationFrame(() => this._loop())
    if (this._lastW !== innerWidth || this._lastH !== innerHeight) this._resize()

    const rawDt = Math.min(0.05, this.clock.getDelta())
    const playing = this.state === 'playing'
    const wdt = rawDt * this.effects.timeScale(rawDt)   // hit-stop slows the world

    // freeze player physics while paused (menu still settles the spawn drop)
    if (this.state !== 'paused') this.player.update(rawDt, playing)
    this.attackCd -= rawDt
    this.hurtSndCd -= rawDt

    if (playing) {
      // servo-skull
      this.bot.update(wdt, this.player, this.enemies,
        (enemy, d) => {
          enemy.hurt(d)
          this.audio.zap()
          this.effects.burst(enemy.group.position, ['#ff6a3d', '#ffd23d'], 4, 2, { size: [0.03, 0.07], life: [0.15, 0.3] })
          if (!enemy.alive) this._onKill(enemy)
        },
        (amt) => this.heal(amt))

      // enemies
      for (const e of this.enemies) {
        const d = e.update(wdt, this.player)
        if (!e.alive) continue
        if (e instanceof Slime) {
          if (d < 1.0) this.damage(16 * wdt)
        } else if (e instanceof VexSkull) {
          if (d < 1.0 && e.hitCd <= 0) { this.damage(8, true); e.hitCd = 1.2 }
        }
      }
      if (this._needsFilter) {
        this.enemies = this.enemies.filter(e => e.alive)
        this._needsFilter = false
      }

      // pickups
      this._pkTarget = this._pkTarget || new THREE.Vector3()
      this._pkTarget.copy(this.player.pos); this._pkTarget.y += 1
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i]
        pk.t += rawDt
        pk.g.position.y = pk.baseY + Math.sin(pk.t * 3) * 0.12
        pk.g.rotation.y += rawDt * 2
        if (pk.g.position.distanceTo(this._pkTarget) < 1.4) {
          this.heal(8)
          this.audio.pickup()
          this.effects.damageNumber(pk.g.position, '+8', '#5be08b')
          this.effects.burst(pk.g.position, ['#5be08b', '#ffffff'], 8, 2, { up: 1 })
          this._removePickup(i)
        } else if (pk.t > 30) {
          this._removePickup(i)
        }
      }

      // passive trickle regen when no medicae skull
      if (this.stats.regen === 0 && this.hp < this.stats.maxHp) this.heal(0.3 * rawDt)

      // enemy respawn, ramping cap with kills
      this.spawnTimer -= rawDt
      const cap = Math.min(11, 6 + Math.floor(this.kills / 4))
      if (this.spawnTimer <= 0) {
        if (this.enemies.length < cap) this._spawnEnemies(1)
        this.spawnTimer = 5   // reset even at cap so a kill doesn't trigger an instant spawn
      }

      // ambient embers drifting near the player
      this.emberT -= rawDt
      if (this.emberT <= 0) {
        this.emberT = 0.25
        const a = Math.random() * Math.PI * 2
        const r = 4 + Math.random() * 8
        const ep = this.player.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 3, Math.sin(a) * r))
        this.effects.ember(ep)
      }

      this.ui.setHealth(this.hp, this.stats.maxHp)
      this._fps(rawDt)
    }

    this.effects.update(wdt)
    this.effects.applyShake(rawDt)
    this.ui.update(rawDt)

    this.composer.render()
  }

  _fps(dt) {
    this._ft = (this._ft || 0) * 0.9 + dt * 0.1
    this._fc = (this._fc || 0) + 1
    if (this._fc % 15 === 0) document.getElementById('fps').textContent = Math.round(1 / (this._ft || dt)) + ' fps'
  }

  _resize() {
    this._lastW = innerWidth; this._lastH = innerHeight
    // a backgrounded/embedded viewport can report 0x0 — hold the last real
    // size (or a sane default) instead of collapsing the framebuffer to 1x1
    if (innerWidth > 0 && innerHeight > 0) { this._goodW = innerWidth; this._goodH = innerHeight }
    const w = this._goodW || 1280
    const h = this._goodH || 720
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new Game() })
