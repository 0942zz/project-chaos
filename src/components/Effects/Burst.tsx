import { useFrame } from '@react-three/fiber'
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { dotTexture } from '../../utils/textures'

export interface BurstHandle {
  fire: (origin: THREE.Vector3, count: number, color: string, speed?: number) => void
}

const POOL = 420

/** Pooled spark / explosion particles. One draw call, fired imperatively. */
export function Burst({ ref, size = 0.11, gravity = 5 }: { ref?: React.Ref<BurstHandle>; size?: number; gravity?: number }) {
  const points = useRef<THREE.Points>(null!)
  const data = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(POOL * 3).fill(9999)
    const col = new Float32Array(POOL * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    return { geo, pos, col, vel: new Float32Array(POOL * 3), life: new Float32Array(POOL), base: new Float32Array(POOL * 3), next: 0, alive: 0 }
  }, [])
  useEffect(() => () => data.geo.dispose(), [data])

  useImperativeHandle(ref, () => ({
    fire(origin, count, color, speed = 3) {
      const c = new THREE.Color(color)
      for (let n = 0; n < count; n++) {
        const i = data.next
        data.next = (data.next + 1) % POOL
        const u = Math.random() * 2 - 1
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(1 - u * u)
        const v = speed * (0.35 + Math.random() * 0.9)
        data.pos.set([origin.x, origin.y, origin.z], i * 3)
        data.vel.set([Math.cos(a) * r * v, u * v + speed * 0.3, Math.sin(a) * r * v], i * 3)
        const k = 1.2 + Math.random() * 1.6
        data.base.set([c.r * k, c.g * k, c.b * k], i * 3)
        data.life[i] = 0.7 + Math.random() * 0.9
      }
      data.alive = 2
    },
  }))

  useFrame((_, rawDt) => {
    if (data.alive <= 0) return
    const dt = Math.min(rawDt, 0.05)
    data.alive -= dt
    for (let i = 0; i < POOL; i++) {
      if (data.life[i] <= 0) continue
      data.life[i] -= dt
      const j = i * 3
      if (data.life[i] <= 0) {
        data.pos[j] = 9999
        continue
      }
      data.vel[j + 1] -= gravity * dt
      data.pos[j] += data.vel[j] * dt
      data.pos[j + 1] += data.vel[j + 1] * dt
      data.pos[j + 2] += data.vel[j + 2] * dt
      const f = Math.min(1, data.life[i] * 1.6)
      data.col[j] = data.base[j] * f
      data.col[j + 1] = data.base[j + 1] * f
      data.col[j + 2] = data.base[j + 2] * f
    }
    data.geo.attributes.position.needsUpdate = true
    data.geo.attributes.color.needsUpdate = true
  })

  return (
    <points ref={points} geometry={data.geo} frustumCulled={false}>
      <pointsMaterial
        size={size}
        map={dotTexture()}
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        sizeAttenuation
      />
    </points>
  )
}
