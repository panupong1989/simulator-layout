import type { Equipment, PlacedItem } from "@/lib/types"

function normRot(rot?: number) {
    return ((((rot ?? 0) % 360) + 360) % 360)
}

function footprint(def: Equipment, rotDeg?: number) {
    const r = normRot(rotDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}

function rectOfPlaced(p: PlacedItem, def: Equipment) {
    const fp = footprint(def, p.rotationDeg)
    const L = p.xCm
    const T = p.yCm
    return { L, T, R: L + fp.wCm, B: T + fp.dCm }
}

function rectOfMoving(xCm: number, yCm: number, fp: { wCm: number; dCm: number }) {
    return { L: xCm, T: yCm, R: xCm + fp.wCm, B: yCm + fp.dCm }
}

function intersects(a: { L: number; T: number; R: number; B: number }, b: { L: number; T: number; R: number; B: number }) {
    return a.L < b.R && a.R > b.L && a.T < b.B && a.B > b.T
}

// ดันออกน้อยสุดจากตัวที่ชน (เลือกทิศ push ที่ระยะน้อยสุด)
function minimalPushOut(a: { L: number; T: number; R: number; B: number }, b: { L: number; T: number; R: number; B: number }, eps = 0.01) {
    // a อยู่ซ้าย b => ดันไปซ้าย; a อยู่ขวา b => ดันไปขวา
    const pushLeft = (b.L - a.R) - eps   // ให้ a.R <= b.L
    const pushRight = (b.R - a.L) + eps   // ให้ a.L >= b.R
    const pushUp = (b.T - a.B) - eps
    const pushDown = (b.B - a.T) + eps

    // เลือกเฉพาะทิศที่แก้ชนได้จริง (ทำให้ไม่ intersect)
    const candidates = [
        { dx: pushLeft, dy: 0, abs: Math.abs(pushLeft) },
        { dx: pushRight, dy: 0, abs: Math.abs(pushRight) },
        { dx: 0, dy: pushUp, abs: Math.abs(pushUp) },
        { dx: 0, dy: pushDown, abs: Math.abs(pushDown) },
    ].sort((u, v) => u.abs - v.abs)

    return candidates[0] // น้อยสุด
}

export function resolveNoOverlap(args: {
    xCm: number
    yCm: number
    fp: { wCm: number; dCm: number }
    placed: PlacedItem[]
    equipments: Equipment[]
    selfId: string
    areaW: number
    areaD: number
    maxIter?: number
}) {
    const { placed, equipments, selfId, areaW, areaD, fp } = args
    let x = args.xCm
    let y = args.yCm
    const maxIter = args.maxIter ?? 8

    for (let iter = 0; iter < maxIter; iter++) {
        let moved = false
        const a = rectOfMoving(x, y, fp)

        for (const p of placed) {
            if (p.instanceId === selfId) continue
            const def = equipments.find(e => e.id === p.equipmentId)
            if (!def) continue
            const b = rectOfPlaced(p, def)

            if (!intersects(a, b)) continue

            const push = minimalPushOut(a, b)
            x += push.dx
            y += push.dy
            moved = true
            break
        }

        // clamp
        x = Math.max(0, Math.min(x, areaW - fp.wCm))
        y = Math.max(0, Math.min(y, areaD - fp.dCm))

        if (!moved) break
    }

    return { xCm: x, yCm: y }
}