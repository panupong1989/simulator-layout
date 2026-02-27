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
