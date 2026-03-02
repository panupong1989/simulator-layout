export type Area = {
    wCm: number
    dCm: number
    gridCm: number
}

export type Equipment = {
    id: string
    name: string
    wCm: number
    dCm: number
    hCm: number
    rotatable?: boolean
    modelScale?: number
    modelRealSizeCm?: { w: number; d: number; h: number }
    imageUrl?: string
    modelUrl: string
}

export type PlacedItem = {
    instanceId: string
    equipmentId: string
    xCm: number
    yCm: number
    rotationDeg: 0 | 90 | 180 | 270
    stackLevel: 0 | 1
    stackBaseId?: string | null
}

export type WallItem = {
    id: string
    x1Cm: number
    y1Cm: number
    x2Cm: number
    y2Cm: number
    thicknessCm: number
}

export type PosterKey = "rule" | "price" | "howto"

export type PosterItem = {
    id: string
    wallId: string
    t: number          // 0..1 ตำแหน่งตามแนวผนัง
    wCm: number
    hCm: number
    offsetCm: number   // ระยะห่างจากผนัง (เริ่ม 0)
    imageKey: PosterKey
}