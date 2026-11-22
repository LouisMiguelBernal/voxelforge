import { CATALOG, pick, computeStats } from './loadout.js'
import { TILES, swatch } from './textures.js'

// ---------------------------------------------------------------------------
// DOM HUD + menus, grimdark edition. Pure DOM/canvas — no framework.
// ---------------------------------------------------------------------------

export const HOTBAR = [3, 8, 7, 11, 12, 13, 14, 15] // stone brick plank iron darkiron bone hazard ember

const $ = (id) => document.getElementById(id)

export class UI {
  constructor(game) {
    this.game = game
    this.selected = 0
    this._vigT = 0
    this._buildHotbar()
    this._buildCustomize($('custOptions'))
    this.renderPreview()
    this.renderStats($('statPanel'))
    this._wire()
  }

  _wire() {
    const click = (fn) => () => { this.game.audio.init(); this.game.audio.click(); fn() }
    $('playBtn').onclick = click(() => this.game.start())
    $('helpBtn').onclick = click(() => $('helpScreen').classList.add('show'))
    $('helpClose').onclick = click(() => $('helpScreen').classList.remove('show'))
    $('resumeBtn').onclick = click(() => this.game.resume())
    $('custBtn').onclick = click(() => { $('pauseScreen').classList.remove('show'); $('startScreen').classList.add('show') })
    $('quitBtn').onclick = click(() => this.game.quit())
  }

  // ---------- hotbar ----------
  _buildHotbar() {
    const bar = $('hotbar')
    bar.innerHTML = ''
    this.slots = HOTBAR.map((id, i) => {
      const s = document.createElement('div')
      s.className = 'slot' + (i === this.selected ? ' active' : '')
      const img = document.createElement('img')
      img.className = 'sw'; img.src = swatch(blockTile(id))
      const k = document.createElement('span'); k.className = 'k'; k.textContent = i + 1
      s.appendChild(k); s.appendChild(img)
      s.onclick = () => this.selectSlot(i)
      bar.appendChild(s)
      return s
    })
  }

  selectSlot(i) {
    this.selected = (i + HOTBAR.length) % HOTBAR.length
    this.slots.forEach((s, k) => s.classList.toggle('active', k === this.selected))
  }
  selectedBlock() { return HOTBAR[this.selected] }
  scroll(dir) { this.selectSlot(this.selected + (dir > 0 ? 1 : -1)) }

  // ---------- HUD ----------
  setHealth(hp, max) {
    if (hp === this._hpShown && max === this._maxShown) return   // called per frame; skip no-op DOM writes
    this._hpShown = hp; this._maxShown = max
    const frac = Math.max(0, hp / max)
    $('healthFill').style.width = (frac * 100) + '%'
    $('healthTxt').textContent = `${Math.ceil(Math.max(0, hp))} / ${max}`
    $('dmgVig').classList.toggle('lowhp', frac < 0.3)
  }

  setKills(n) { $('kills').textContent = `☠ PURGED · ${n}` }

  hitmarker() {
    const el = $('hitmarker')
    el.classList.remove('show')
    void el.offsetWidth      // restart animation
    el.classList.add('show')
  }

  damageFlash(amt = 0.5) { this._vigT = Math.min(1, this._vigT + amt) }

  toast(msg, ms = 2200) {
    const el = $('toast')
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(this._toastT)
    this._toastT = setTimeout(() => el.classList.remove('show'), ms)
  }

  update(dt) {
    if (this._vigT > 0.002) {
      this._vigT *= Math.exp(-2.2 * dt)
      $('dmgVig').style.opacity = Math.min(0.85, this._vigT)
    } else if (this._vigT !== 0) {
      this._vigT = 0
      $('dmgVig').style.opacity = 0
    }
  }

  renderLoadHud(stats, load) {
    $('loadHud').innerHTML = `
      <h4>⚙ WARGEAR</h4>
      <div class="row"><span>${pick('weapon', load.weapon).name}</span><span>${stats.damage} dmg</span></div>
      <div class="row"><span>${pick('helmet', load.helmet).name}</span><span>+${pick('helmet', load.helmet).defense} def</span></div>
      <div class="row"><span>${pick('chest', load.chest).name}</span><span>+${pick('chest', load.chest).defense} def</span></div>
      <div class="row"><span>${pick('bot', load.bot).name}</span><span>${pick('bot', load.bot).role}</span></div>
      <div class="row total"><span>DEFENSE</span><span>${stats.defense}</span></div>`
  }

  // ---------- customization ----------
  _buildCustomize(root) {
    root.innerHTML = ''
    const load = this.game.load
    const slots = [['weapon', '⚔ WEAPON'], ['helmet', '⛑ HELMET'], ['chest', '⛨ ARMOUR'], ['bot', '☠ SERVO-SKULL']]
    for (const [slot, label] of slots) {
      const col = document.createElement('div')
      col.innerHTML = `<h3>${label}</h3>`
      const opts = document.createElement('div'); opts.className = 'opts'
      for (const o of CATALOG[slot]) {
        const el = document.createElement('div')
        el.className = 'opt' + (load[slot] === o.id ? ' sel' : '')
        el.innerHTML = `<span class="chip" style="background:${o.color}"></span>${o.name}`
        el.onclick = () => {
          load[slot] = o.id
          opts.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'))
          el.classList.add('sel')
          this.game.audio.click()
          this.game.onLoadoutChange()
          this.renderPreview()
          this.renderStats($('statPanel'))
        }
        opts.appendChild(el)
      }
      col.appendChild(opts)
      root.appendChild(col)
    }
  }

  renderStats(root) {
    const s = computeStats(this.game.load)
    root.innerHTML = `
      <div class="statline"><span>Max Health</span><b>${s.maxHp}</b></div>
      <div class="statline"><span>Damage</span><b>${s.damage}</b></div>
      <div class="statline"><span>Defense</span><b>${s.defense}</b></div>
      <div class="statline"><span>Crit Chance</span><b>${Math.round(s.crit * 100)}%</b></div>
      <div class="statline"><span>Knockback</span><b>${s.kb.toFixed(1)}</b></div>
      <div class="statline"><span>Reach</span><b>${s.reach.toFixed(1)}</b></div>
      <div class="statline"><span>Move Speed</span><b>${s.speed.toFixed(1)}</b></div>
      <div class="statline"><span>Mining</span><b>${s.mine.toFixed(1)}x</b></div>`
  }

  // ---------- smooth-shaded character preview ----------
  renderPreview() {
    const cv = $('preview'); const ctx = cv.getContext('2d')
    const W = cv.width, H = cv.height
    ctx.clearRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = true

    // moody backdrop + floor shadow
    const bg = ctx.createRadialGradient(W / 2, H * 0.35, 30, W / 2, H * 0.5, H * 0.75)
    bg.addColorStop(0, '#26202e'); bg.addColorStop(1, '#0b0910')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.beginPath(); ctx.ellipse(W / 2, H - 46, 92, 16, 0, 0, Math.PI * 2); ctx.fill()

    const load = this.game.load
    const helm = pick('helmet', load.helmet)
    const chest = pick('chest', load.chest)
    const weap = pick('weapon', load.weapon)
    const bot = pick('bot', load.bot)
    const gold = '#d0aa54'
    const cx = W / 2, top = 66

    // gradient-shaded rounded rect
    const rr = (x, y, w, h, r, c1, c2) => {
      const g = ctx.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, c1); g.addColorStop(1, c2 || shade(c1, -50))
      ctx.fillStyle = g
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill()
    }
    const glowRect = (x, y, w, h, r, color, blur = 14) => {
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur
      rr(x, y, w, h, r, color, shade(color, -30)); ctx.restore()
    }

    // legs + boots
    rr(cx - 34, top + 214, 27, 66, 8, shade(chest.color, -20))
    rr(cx + 7, top + 214, 27, 66, 8, shade(chest.color, -20))
    rr(cx - 38, top + 272, 34, 22, 7, '#2a2c34')
    rr(cx + 4, top + 272, 34, 22, 7, '#2a2c34')
    // torso
    rr(cx - 42, top + 106, 84, 116, 16, shade(chest.color, 30), shade(chest.color, -45))
    // chest glow line + belt
    rr(cx - 22, top + 140, 44, 8, 4, gold, shade(gold, -40))
    rr(cx - 42, top + 202, 84, 13, 6, '#221a12')
    ctx.fillStyle = '#d6ccae'
    ctx.beginPath(); ctx.arc(cx, top + 208, 8, 0, Math.PI * 2); ctx.fill()
    // pauldrons
    rr(cx - 76, top + 96, 38, 48, 14, shade(chest.color, 45), shade(chest.color, -30))
    rr(cx + 38, top + 96, 38, 48, 14, shade(chest.color, 45), shade(chest.color, -30))
    rr(cx - 76, top + 96, 38, 11, [14, 14, 0, 0], gold)
    rr(cx + 38, top + 96, 38, 11, [14, 14, 0, 0], gold)
    // arms
    rr(cx - 66, top + 144, 22, 62, 9, shade(chest.color, -12))
    rr(cx + 44, top + 144, 22, 62, 9, shade(chest.color, -12))
    // head
    rr(cx - 26, top + 22, 52, 66, 20, '#e0bb8e', '#b08a5e')

    // helmet variants (drawn over the head)
    if (helm.id === 'scout') {
      rr(cx - 30, top + 12, 60, 32, 14, shade(helm.color, 25), shade(helm.color, -30))
    } else if (helm.id === 'aquila') {
      rr(cx - 30, top + 10, 60, 44, 16, shade(helm.color, 30), shade(helm.color, -35))
      rr(cx - 12, top + 58, 24, 22, 6, '#25344c')
      glowRect(cx - 18, top + 44, 10, 8, 4, '#ff4030', 10)
      glowRect(cx + 8, top + 44, 10, 8, 4, '#ff4030', 10)
    } else if (helm.id === 'term') {
      rr(cx - 36, top + 6, 72, 48, 16, shade(helm.color, 35), shade(helm.color, -30))
      rr(cx - 42, top + 42, 12, 30, 6, '#e6ddc4')
      rr(cx + 30, top + 42, 12, 30, 6, '#e6ddc4')
      glowRect(cx - 18, top + 40, 10, 8, 4, '#ff4030', 10)
      glowRect(cx + 8, top + 40, 10, 8, 4, '#ff4030', 10)
    } else if (helm.id === 'psyker') {
      rr(cx - 34, top + 6, 68, 26, 12, shade(helm.color, 20), shade(helm.color, -25))
      rr(cx - 38, top + 24, 16, 60, 8, shade(helm.color, -10))
      rr(cx + 22, top + 24, 16, 60, 8, shade(helm.color, -10))
      glowRect(cx - 5, top - 8, 10, 18, 5, '#b58cff', 16)
    } else {
      // bare head: eyes
      ctx.fillStyle = '#241610'
      ctx.beginPath(); ctx.arc(cx - 10, top + 50, 4, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(cx + 10, top + 50, 4, 0, Math.PI * 2); ctx.fill()
    }

    // weapon at the right hand
    const wx = cx + 72
    if (weap.shape === 'chain') {
      rr(wx, top + 40, 15, 128, 5, '#6a7280', '#3c424e')
      for (let i = 0; i < 7; i++) rr(wx + 13, top + 46 + i * 17, 7, 9, 3, '#eef1f5', '#b8bec9')
      rr(wx - 6, top + 166, 27, 16, 6, weap.trim)
    } else if (weap.shape === 'sword') {
      glowRect(wx + 2, top + 26, 11, 140, 5, weap.color, 22)
      rr(wx - 10, top + 164, 35, 11, 5, gold)
      rr(wx + 1, top + 174, 13, 26, 5, '#241812')
    } else if (weap.shape === 'hammer') {
      rr(wx + 2, top + 40, 10, 150, 5, weap.trim)
      rr(wx - 22, top + 16, 58, 42, 10, '#6e675c', '#42403a')
      glowRect(wx - 22, top + 10, 58, 10, 5, weap.color, 18)
    } else if (weap.shape === 'fist') {
      glowRect(wx - 12, top + 138, 46, 50, 14, weap.color, 16)
      rr(wx - 12, top + 132, 46, 10, 5, '#8ab8ff')
    } else if (weap.shape === 'pick') {
      rr(wx + 2, top + 44, 10, 144, 5, weap.trim)
      rr(wx - 26, top + 44, 66, 13, 6, weap.color, shade(weap.color, -40))
      rr(wx - 2, top + 40, 18, 22, 7, gold)
    }

    // servo-skull companion, hovering with a soft glow
    if (bot.role !== 'none') {
      const bx = cx - 118, by = top + 96 + Math.sin(Date.now() / 500) * 4
      ctx.save(); ctx.shadowColor = bot.color; ctx.shadowBlur = 20
      rr(bx, by, 36, 32, 13, '#e2dac6', '#a89f88')
      ctx.restore()
      rr(bx + 6, by + 26, 24, 12, 5, '#cfc6b0', '#948b76')
      glowRect(bx + 6, by + 12, 8, 7, 3, bot.color, 8)
      glowRect(bx + 22, by + 12, 8, 7, 3, bot.color, 8)
      rr(bx + 15, by - 12, 4, 12, 2, '#6a6255')
      glowRect(bx + 12, by - 18, 10, 8, 4, bot.color, 12)
    }

    ctx.fillStyle = gold
    ctx.font = '600 13px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.letterSpacing = '3px'
    ctx.fillText('YOUR CRUSADER', cx, H - 14)
  }
}

function blockTile(id) {
  const map = {
    1: TILES.grassTop, 2: TILES.dirt, 3: TILES.stone, 6: TILES.ash, 7: TILES.plank,
    8: TILES.brick, 9: TILES.glass, 10: TILES.brass, 11: TILES.ironPlate,
    12: TILES.darkIron, 13: TILES.bone, 14: TILES.hazard, 15: TILES.ember, 16: TILES.gothic
  }
  return map[id] ?? TILES.stone
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}
