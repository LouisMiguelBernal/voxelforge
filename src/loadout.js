// ---------------------------------------------------------------------------
// Grimdark loadout catalog. Every piece carries real stats that feed combat,
// movement, mining and the servo-skull companion. Persisted to localStorage.
// ---------------------------------------------------------------------------

export const CATALOG = {
  helmet: [
    { id: 'none',   name: 'Bare Head',        color: '#caa06a', defense: 0, hp: 0 },
    { id: 'scout',  name: 'Scout Cowl',       color: '#5d4a2f', defense: 1, hp: 4 },
    { id: 'aquila', name: 'Aquila Helm',      color: '#3d5a8c', defense: 3, hp: 8 },
    { id: 'term',   name: 'Terminator Helm',  color: '#8c8f9c', defense: 5, hp: 12, speed: -0.3 },
    { id: 'psyker', name: 'Psyker Hood',      color: '#5c3d8c', defense: 1, hp: 4, luck: 2, reach: 0.6 }
  ],
  chest: [
    { id: 'fatigues',  name: 'Recruit Fatigues',  color: '#4f5a3d', defense: 0, hp: 0,  speed: 0.3 },
    { id: 'carapace',  name: 'Carapace Armour',   color: '#54504a', defense: 3, hp: 8,  speed: 0 },
    { id: 'power',     name: 'Power Armour',      color: '#38508c', defense: 6, hp: 16, speed: -0.3 },
    { id: 'term',      name: 'Terminator Plate',  color: '#9aa0ad', defense: 9, hp: 24, speed: -1.0 },
    { id: 'artificer', name: 'Artificer Armour',  color: '#8c6d2e', defense: 5, hp: 14, luck: 1 }
  ],
  weapon: [
    { id: 'chain',  name: 'Chainsword',     color: '#b8bec9', trim: '#8c2020', damage: 9,  reach: 3.4, speed: 1.8,  mine: 1.1, kb: 1.2, shape: 'chain' },
    { id: 'psword', name: 'Power Sword',    color: '#79d4ff', trim: '#20304a', damage: 15, reach: 3.7, speed: 1.15, mine: 1.4, kb: 2.2, shape: 'sword', glow: '#5ec8ff' },
    { id: 'hammer', name: 'Thunder Hammer', color: '#ffb347', trim: '#3a2c18', damage: 32, reach: 3.3, speed: 0.5,  mine: 2.4, kb: 6.5, shape: 'hammer', glow: '#ff9a30' },
    { id: 'fist',   name: 'Power Fist',     color: '#3a6fd8', trim: '#1a2438', damage: 24, reach: 2.9, speed: 0.62, mine: 1.8, kb: 5.0, shape: 'fist', glow: '#4a8aff' },
    { id: 'pick',   name: 'Omnissian Pick', color: '#ff8c3d', trim: '#3c2c1c', damage: 11, reach: 3.5, speed: 1.25, mine: 3.4, kb: 1.6, shape: 'pick' }
  ],
  bot: [
    { id: 'none',    name: 'No Companion',  color: '#555',    role: 'none' },
    { id: 'medicae', name: 'Medicae Skull', color: '#5be08b', role: 'heal',   rate: 1.5 },
    { id: 'gladius', name: 'Gun-Skull',     color: '#ff6a3d', role: 'combat', dps: 8 },
    { id: 'auspex',  name: 'Auspex Skull',  color: '#ffd23d', role: 'mine',   luck: 2 },
    { id: 'cherub',  name: 'Cherub Drone',  color: '#5bb8ff', role: 'speed',  speed: 1.0 }
  ]
}

const LS_KEY = 'vf_loadout'

export function defaultLoadout() {
  const base = { helmet: 'aquila', chest: 'power', weapon: 'chain', bot: 'medicae' }
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY))
    if (saved) {
      for (const slot of Object.keys(base)) {
        if (saved[slot] && CATALOG[slot].some(o => o.id === saved[slot])) base[slot] = saved[slot]
      }
    }
  } catch { /* corrupt storage -> defaults */ }
  return base
}

export function saveLoadout(load) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(load)) } catch { /* private mode */ }
}

export function pick(slot, id) {
  return CATALOG[slot].find(o => o.id === id) || CATALOG[slot][0]
}

export function computeStats(load) {
  const h = pick('helmet', load.helmet)
  const c = pick('chest', load.chest)
  const w = pick('weapon', load.weapon)
  const b = pick('bot', load.bot)

  const maxHp = 20 + (h.hp || 0) + (c.hp || 0)
  const defense = (h.defense || 0) + (c.defense || 0)
  const luck = (h.luck || 0) + (c.luck || 0) + (b.luck || 0)
  const speed = 4.3 + (c.speed || 0) + (h.speed || 0) + (b.role === 'speed' ? b.speed : 0)
  const reach = w.reach + (h.reach || 0)

  return {
    maxHp, defense, luck, speed, reach,
    damage: w.damage,
    attackSpeed: w.speed,
    kb: w.kb,
    crit: 0.08 + luck * 0.03,
    mine: w.mine + luck * 0.15,
    weapon: w,
    bot: b,
    regen: b.role === 'heal' ? b.rate : 0,
    botDps: b.role === 'combat' ? b.dps : 0
  }
}
