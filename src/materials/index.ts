import * as THREE from 'three'

/** Shared premium material library. Reused across every scene. */
export const M = {
  gold: new THREE.MeshStandardMaterial({ color: '#e8b64a', metalness: 1, roughness: 0.24 }),
  goldBrushed: new THREE.MeshStandardMaterial({ color: '#c9973a', metalness: 1, roughness: 0.42 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#f1f3f8', metalness: 1, roughness: 0.07 }),
  blackMetal: new THREE.MeshStandardMaterial({ color: '#0b0b12', metalness: 0.92, roughness: 0.32 }),
  darkPanel: new THREE.MeshStandardMaterial({ color: '#12111c', metalness: 0.7, roughness: 0.5 }),
  gloss: new THREE.MeshPhysicalMaterial({ color: '#08070d', metalness: 0.6, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }),
}

export const enamel = (color: string, emissive = color): THREE.MeshPhysicalMaterial =>
  new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.25,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    emissive,
    emissiveIntensity: 0.12,
  })

export const glow = (color: string, intensity = 2): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, toneMapped: false })
