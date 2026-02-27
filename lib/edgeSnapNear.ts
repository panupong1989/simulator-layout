import type { Equipment, PlacedItem } from "@/lib/types"

export type SnapResult = { xCm: number; yCm: number; snappedX: boolean; snappedY: boolean }

// -------------------------
// helpers
// -------------------------
function normRot(rotDeg?: number) {
    return (((rotDeg ?? 0) % 360) + 360) % 360
}

// หมุน 90/270 = สลับ w/d
function footprintFromDef(def: Equipment, rotDeg?: number) {
    const r = normRot(rotDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}

/**
 * Front edge mapping (ตามที่คุณกำหนด)
 * rot:0   => front = BOTTOM (ลูกศรชี้ลง)
 * rot:90  => front = LEFT
 * rot:180 => front = TOP
 * rot:270 => front = RIGHT
 */
function frontEdgeLine(xCm: number, yCm: number, wCm: number, dCm: number, rotDeg: number) {
    const r = normRot(rotDeg)
    if (r === 0) return { axis: "y" as const, v: yCm + dCm } // bottom
    if (r === 180) return { axis: "y" as const, v: yCm }     // top
    if (r === 90) return { axis: "x" as const, v: xCm }      // left
    if (r === 270) return { axis: "x" as const, v: xCm + wCm } // right
    return { axis: "y" as const, v: yCm + dCm }
}

// -------------------------
// main
// -------------------------
export function edgeSnapNearCm(args: {
    xCm: number
    yCm: number
    moving: { wCm: number; dCm: number } // ส่ง footprint ของตัวที่กำลังลาก
    movingRotDeg: number                 // ✅ ต้องส่ง rot ของตัวที่ลากมาด้วย
    placed: PlacedItem[]
    equipments: Equipment[]
    selfId: string
    areaW: number
    areaD: number
    snapRadiusCm: number
    overlapMinCm?: number
    overlapSlackCm?: number

    // ✅ เพิ่ม: แรงดูดแนวหน้า (ถ้าไม่ใส่จะใช้ snapRadiusCm)
    frontSnapRadiusCm?: number

    // ✅ เพิ่ม: แรงดูดมุมชนมุม
    cornerSnapRadiusCm?: number
}): SnapResult {
    const {
        xCm,
        yCm,
        moving,
        movingRotDeg,
        placed,
        equipments,
        selfId,
        areaW,
        areaD,
        snapRadiusCm,
        overlapMinCm = 0.2,
        overlapSlackCm = 0.8,
        frontSnapRadiusCm = snapRadiusCm,
        cornerSnapRadiusCm = snapRadiusCm,
    } = args

    // A edges (ตัวที่ลาก)
    const aL = xCm
    const aR = xCm + moving.wCm
    const aT = yCm
    const aB = yCm + moving.dCm

    // best edge
    let bestDxAbs = snapRadiusCm + 1
    let bestDyAbs = snapRadiusCm + 1
    let bestDx = 0
    let bestDy = 0

    // best corner (priority #1)
    let hasCorner = false
    let bestCornerDist = cornerSnapRadiusCm + 1
    let bestCornerDx = 0
    let bestCornerDy = 0

    // best front align (priority #2)
    let hasFront = false
    let bestFrontAbs = frontSnapRadiusCm + 1
    let bestFrontDx = 0
    let bestFrontDy = 0

    // A front line
    const aFront = frontEdgeLine(xCm, yCm, moving.wCm, moving.dCm, movingRotDeg)

    for (const p of placed) {
        if (p.instanceId === selfId) continue

        const def = equipments.find((e) => e.id === p.equipmentId)
        if (!def) continue

        // B footprint (ตาม rot ของมัน)
        const bFp = footprintFromDef(def, p.rotationDeg)

        const bL = p.xCm
        const bR = p.xCm + bFp.wCm
        const bT = p.yCm
        const bB = p.yCm + bFp.dCm

        const overlapX = Math.min(aR, bR) - Math.max(aL, bL)
        const overlapY = Math.min(aB, bB) - Math.max(aT, bT)

        // -----------------------------
        // (1) Corner snap ANY-to-ANY (มุมชนมุม ดูดเข้ามุมเลย)  ✅ priority สูงสุด
        // -----------------------------
        const aCorners = [
            { x: aL, y: aT }, // TL
            { x: aR, y: aT }, // TR
            { x: aL, y: aB }, // BL
            { x: aR, y: aB }, // BR
        ]
        const bCorners = [
            { x: bL, y: bT },
            { x: bR, y: bT },
            { x: bL, y: bB },
            { x: bR, y: bB },
        ]

        for (const ac of aCorners) {
            for (const bc of bCorners) {
                const dx = bc.x - ac.x
                const dy = bc.y - ac.y

                // กันดูดไกล: ต้องอยู่ใน radius ทั้ง 2 แกน
                if (Math.abs(dx) > cornerSnapRadiusCm || Math.abs(dy) > cornerSnapRadiusCm) continue

                const dist = Math.hypot(dx, dy)
                if (dist < bestCornerDist) {
                    bestCornerDist = dist
                    bestCornerDx = dx
                    bestCornerDy = dy
                    hasCorner = true
                }
            }
        }

        // -----------------------------
        // (2) Front-to-front align (หันหน้าแกนเดียวกัน) ✅ priority รองจาก corner
        // -----------------------------
        const bFront = frontEdgeLine(p.xCm, p.yCm, bFp.wCm, bFp.dCm, p.rotationDeg ?? 0)

        if (aFront.axis === bFront.axis) {
            // ต้อง overlap พอในแกนตั้งฉาก เพื่อกันดูดมั่ว
            const okOverlap =
                aFront.axis === "y"
                    ? overlapX >= overlapMinCm - overlapSlackCm
                    : overlapY >= overlapMinCm - overlapSlackCm

            if (okOverlap) {
                if (aFront.axis === "y") {
                    const dy = bFront.v - aFront.v
                    const abs = Math.abs(dy)
                    if (abs <= frontSnapRadiusCm && abs < bestFrontAbs) {
                        bestFrontAbs = abs
                        bestFrontDy = dy
                        bestFrontDx = 0
                        hasFront = true
                    }
                } else {
                    const dx = bFront.v - aFront.v
                    const abs = Math.abs(dx)
                    if (abs <= frontSnapRadiusCm && abs < bestFrontAbs) {
                        bestFrontAbs = abs
                        bestFrontDx = dx
                        bestFrontDy = 0
                        hasFront = true
                    }
                }
            }
        }

        // -----------------------------
        // (3) Edge snap X (ชนขอบซ้าย/ขวา) ต้องมี overlapY
        // -----------------------------
        if (overlapY >= overlapMinCm - overlapSlackCm) {
            let dx = bR - aL // aL -> bR
            if (Math.abs(dx) <= snapRadiusCm && Math.abs(dx) < bestDxAbs) {
                bestDxAbs = Math.abs(dx)
                bestDx = dx
            }
            dx = bL - aR // aR -> bL
            if (Math.abs(dx) <= snapRadiusCm && Math.abs(dx) < bestDxAbs) {
                bestDxAbs = Math.abs(dx)
                bestDx = dx
            }
        }

        // -----------------------------
        // (4) Edge snap Y (ชนขอบบน/ล่าง) ต้องมี overlapX
        // -----------------------------
        if (overlapX >= overlapMinCm - overlapSlackCm) {
            let dy = bB - aT // aT -> bB
            if (Math.abs(dy) <= snapRadiusCm && Math.abs(dy) < bestDyAbs) {
                bestDyAbs = Math.abs(dy)
                bestDy = dy
            }
            dy = bT - aB // aB -> bT
            if (Math.abs(dy) <= snapRadiusCm && Math.abs(dy) < bestDyAbs) {
                bestDyAbs = Math.abs(dy)
                bestDy = dy
            }
        }
    }

    // -----------------------------
    // apply priority: corner > front > edge
    // -----------------------------
    let snapX = xCm
    let snapY = yCm
    let snappedX = false
    let snappedY = false

    if (hasCorner) {
        snapX = xCm + bestCornerDx
        snapY = yCm + bestCornerDy
        snappedX = true
        snappedY = true
    } else if (hasFront) {
        snapX = xCm + bestFrontDx
        snapY = yCm + bestFrontDy
        snappedX = bestFrontDx !== 0
        snappedY = bestFrontDy !== 0
    } else {
        if (bestDxAbs <= snapRadiusCm) {
            snapX = xCm + bestDx
            snappedX = true
        }
        if (bestDyAbs <= snapRadiusCm) {
            snapY = yCm + bestDy
            snappedY = true
        }
    }

    // clamp ในพื้นที่
    const maxX = areaW - moving.wCm
    const maxY = areaD - moving.dCm
    snapX = Math.max(0, Math.min(snapX, maxX))
    snapY = Math.max(0, Math.min(snapY, maxY))

    return { xCm: snapX, yCm: snapY, snappedX, snappedY }
}