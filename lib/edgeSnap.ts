import type { Equipment, PlacedItem } from "@/lib/types"

function overlapLen(a0: number, a1: number, b0: number, b1: number) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export function edgeSnapCm(args: {
    xCm: number
    yCm: number
    moving: { wCm: number; dCm: number }
    placed: PlacedItem[]
    equipments: Equipment[]
    selfId: string
    thresholdCm: number

    // ✅ optional tuning (ไม่ใส่ก็ได้)
    minOverlapCm?: number       // ต้อง overlap อย่างน้อยเท่านี้ ถึงจะดูด (แนะนำ 5)
    useCenterSnap?: boolean     // ดูดให้กึ่งกลางตรงกันด้วยไหม (แนะนำ false)
}) {
    let { xCm, yCm } = args
    const { wCm, dCm } = args.moving

    const minOverlapCm = args.minOverlapCm ?? 5
    const useCenterSnap = args.useCenterSnap ?? false

    const mL = xCm
    const mR = xCm + wCm
    const mT = yCm
    const mB = yCm + dCm
    const mCx = xCm + wCm / 2
    const mCy = yCm + dCm / 2

    let bestDx = 0
    let bestDy = 0
    let bestAbsDx = args.thresholdCm + 1
    let bestAbsDy = args.thresholdCm + 1

    for (const p of args.placed) {
        if (p.instanceId === args.selfId) continue
        const def = args.equipments.find((e) => e.id === p.equipmentId)
        if (!def) continue

        const oL = p.xCm
        const oR = p.xCm + def.wCm
        const oT = p.yCm
        const oB = p.yCm + def.dCm
        const oCx = p.xCm + def.wCm / 2
        const oCy = p.yCm + def.dCm / 2

        // ✅ overlap gate
        const yOverlap = overlapLen(mT, mB, oT, oB)
        const xOverlap = overlapLen(mL, mR, oL, oR)

        // -----------------------
        // Snap X (ชิดซ้าย/ขวา) ต้องมี Y overlap พอ
        // -----------------------
        if (yOverlap >= minOverlapCm) {
            const dxs = [
                oR - mL, // moving left -> other right
                oL - mR, // moving right -> other left
                oL - mL, // left -> left
                oR - mR, // right -> right
            ]

            if (useCenterSnap) dxs.push(oCx - mCx)

            for (const dx of dxs) {
                const adx = Math.abs(dx)
                if (adx <= args.thresholdCm && adx < bestAbsDx) {
                    bestAbsDx = adx
                    bestDx = dx
                }
            }
        }

        // -----------------------
        // Snap Y (ชิดบน/ล่าง) ต้องมี X overlap พอ
        // -----------------------
        if (xOverlap >= minOverlapCm) {
            const dys = [
                oB - mT, // top -> other bottom
                oT - mB, // bottom -> other top
                oT - mT, // top -> top
                oB - mB, // bottom -> bottom
            ]

            if (useCenterSnap) dys.push(oCy - mCy)

            for (const dy of dys) {
                const ady = Math.abs(dy)
                if (ady <= args.thresholdCm && ady < bestAbsDy) {
                    bestAbsDy = ady
                    bestDy = dy
                }
            }
        }
    }

    return { xCm: xCm + bestDx, yCm: yCm + bestDy }
}