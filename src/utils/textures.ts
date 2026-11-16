import * as THREE from 'three'

const cache = new Map<string, THREE.CanvasTexture>()

export const DISPLAY_FONT = 'Oswald, "Arial Narrow", Impact, sans-serif'

export interface LabelOptions {
  color?: string
  width?: number
  height?: number
  size?: number
  /** Draw the text rotated 90° so it reads along the long axis of a tall label. */
  vertical?: boolean
  stroke?: string
  glow?: string
  sub?: string
  weight?: number
}

/** Crisp text rendered once to a canvas and cached; used for every 3D label. */
export function labelTexture(text: string, o: LabelOptions = {}): THREE.CanvasTexture {
  const key = JSON.stringify([text, o])
  const hit = cache.get(key)
  if (hit) return hit
  const w = o.width ?? 256
  const h = o.height ?? 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.translate(w / 2, h / 2)
  if (o.vertical) g.rotate(-Math.PI / 2)
  const size = o.size ?? Math.min(w, h) * 0.7
  g.font = `${o.weight ?? 700} ${size}px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (o.glow) {
    g.shadowColor = o.glow
    g.shadowBlur = size * 0.25
  }
  if (o.stroke) {
    g.lineWidth = size * 0.09
    g.strokeStyle = o.stroke
    g.lineJoin = 'round'
    g.strokeText(text, 0, o.sub ? -size * 0.18 : size * 0.04)
  }
  g.fillStyle = o.color ?? '#ffffff'
  g.fillText(text, 0, o.sub ? -size * 0.18 : size * 0.04)
  if (o.sub) {
    g.font = `600 ${size * 0.3}px ${DISPLAY_FONT}`
    g.fillText(o.sub, 0, size * 0.52)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  cache.set(key, tex)
  return tex
}

/** Embossed-looking coin faces: a radiant sun and a crescent moon. */
export function coinTexture(side: 'SUN' | 'MOON'): THREE.CanvasTexture {
  const key = `coin:${side}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = 512
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(s / 2, s * 0.4, 20, s / 2, s / 2, s / 2)
  if (side === 'SUN') {
    grad.addColorStop(0, '#fff3b0')
    grad.addColorStop(0.6, '#e2a81c')
    grad.addColorStop(1, '#8a5a06')
  } else {
    grad.addColorStop(0, '#f2f6ff')
    grad.addColorStop(0.6, '#9aa7c4')
    grad.addColorStop(1, '#39425c')
  }
  g.fillStyle = grad
  g.beginPath()
  g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = side === 'SUN' ? '#6b4404' : '#232a40'
  g.lineWidth = 10
  g.beginPath()
  g.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 3
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2
    g.beginPath()
    g.moveTo(s / 2 + Math.cos(a) * s * 0.455, s / 2 + Math.sin(a) * s * 0.455)
    g.lineTo(s / 2 + Math.cos(a) * s * 0.49, s / 2 + Math.sin(a) * s * 0.49)
    g.stroke()
  }
  g.translate(s / 2, s / 2)
  const ink = side === 'SUN' ? '#5a3802' : '#1b2238'
  g.fillStyle = ink
  if (side === 'SUN') {
    for (let i = 0; i < 16; i++) {
      g.rotate((Math.PI * 2) / 16)
      g.beginPath()
      const len = i % 2 ? 0.36 : 0.3
      g.moveTo(-14, -s * 0.2)
      g.lineTo(0, -s * len)
      g.lineTo(14, -s * 0.2)
      g.fill()
    }
    g.beginPath()
    g.arc(0, 0, s * 0.16, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffe58a'
    g.beginPath()
    g.arc(0, 0, s * 0.125, 0, Math.PI * 2)
    g.fill()
  } else {
    g.beginPath()
    g.arc(0, 0, s * 0.27, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'destination-out'
    g.beginPath()
    g.arc(s * 0.11, -s * 0.05, s * 0.23, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'destination-over'
    g.fillStyle = grad
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.beginPath()
    g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'source-over'
    g.translate(s / 2, s / 2)
    g.fillStyle = ink
    for (const [x, y, r] of [[0.17, -0.2, 9], [0.26, 0.02, 6], [0.12, 0.2, 7]] as const) {
      g.beginPath()
      g.arc(s * x, s * y, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.font = `700 34px ${DISPLAY_FONT}`
  g.textAlign = 'center'
  g.fillStyle = ink
  g.fillText(side, s / 2, s * 0.9)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  cache.set(key, tex)
  return tex
}

/** Soft round sprite for point particles. */
export function dotTexture(): THREE.CanvasTexture {
  const hit = cache.get('dot')
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  cache.set('dot', tex)
  return tex
}
