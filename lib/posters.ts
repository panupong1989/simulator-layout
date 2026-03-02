// src/lib/posters.ts
export type PosterKey = "rule" | "price" | "howto"

export type PosterItem = {
    id: string
    wallId: string
    t: number           // 0..1 ตามแนวผนัง
    wCm: number
    hCm: number
    offsetCm?: number   // เผื่อดันออกจากผนังใน 2D/3D (optional)
    imageKey: PosterKey
    flip?: boolean 
}

export const POSTER_SPECS: Record<PosterKey, { wCm: number; hCm: number }> = {
    rule: { wCm: 60, hCm: 120 },
    price: { wCm: 90, hCm: 90 },
    howto: { wCm: 90, hCm: 90 },
}