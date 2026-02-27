"use client"

import { useMemo } from "react"
import { Shape, Path, ExtrudeGeometry, Vector3, DoubleSide } from "three"

const CM_TO_M = 0.01

export type WallItem = {
    id: string
    x1Cm: number
    y1Cm: number
    x2Cm: number
    y2Cm: number
    thicknessCm: number
}

export type PlacedItem = {
    instanceId: string
    equipmentId: string
    xCm: number
    yCm: number
    rotationDeg?: number
    stackLevel?: 0 | 1
    stackBaseId?: string | null
}

export type Equipment = {
    id: string
    wCm: number
    dCm: number
    hCm: number
}

type Props = {
    walls: WallItem[]
    placed: PlacedItem[]
    equipments: Equipment[]
    areaWm: number
    areaDm: number
    heightM?: number
    floorIsCentered?: boolean
    color?: string

    /** ระยะถือว่า "แตะผนัง" */
    gapToWallCm?: number

    /** เผื่อความสูงร่องเพิ่ม (เช่น 10cm) */
    gapHeightCm?: number

    /** สูงร่องกรณีเครื่องเดี่ยว (cm) */
    notchSingleHeightCm?: number // default 105

    /** สูงร่องกรณีซ้อน 2 ชั้น (cm) */
    notchStackHeightCm?: number // default 210

    /** เผื่อปลายร่องซ้าย/ขวา (cm) กันขอบไม่ครบ */
    endPadCm?: number
}

function normRot(rotDeg?: number) {
    return (((rotDeg ?? 0) % 360) + 360) % 360
}

function footprintCm(def: Equipment, rotDeg?: number) {
    const r = normRot(rotDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n))
}

/** ทำ hole ให้เป็น CW (ตรงข้ามกับ outer) เพื่อให้ Three มองว่าเป็นรูจริง */
function addRectHoleCW(shape: Shape, x0: number, x1: number, y0: number, y1: number) {
    const h = new Path()
    h.moveTo(x0, y0)
    h.lineTo(x0, y1)
    h.lineTo(x1, y1)
    h.lineTo(x1, y0)
    h.closePath()
    shape.holes.push(h)
}

/**
 * Walls3D_NotchPro (Stable)
 * - ผนัง 1 segment = geometry เดียว
 * - เจาะทะลุทั้งความหนา (holes)
 * - ความสูงร่อง: single/stack + gapHeight
 * - สำคัญ: ห้าม center ซ้ำ / ห้าม flip แกนมั่ว ๆ
 */
export default function Walls3D_NotchPro({
    walls,
    placed,
    equipments,
    areaWm,
    areaDm,
    heightM = 3,
    floorIsCentered = true,
    color = "#ffffff",
    gapToWallCm = 5,
    gapHeightCm = 10,
    notchSingleHeightCm = 105,
    notchStackHeightCm = 210,
    endPadCm = 5,
}: Props) {
    const gapM = gapToWallCm * CM_TO_M
    const gapHM = gapHeightCm * CM_TO_M
    const singleHM = notchSingleHeightCm * CM_TO_M
    const stackHM = notchStackHeightCm * CM_TO_M
    const endPadM = endPadCm * CM_TO_M

    const items = useMemo(() => {
        const eqById = new Map<string, Equipment>()
        for (const e of equipments ?? []) eqById.set(e.id, e)

        // baseId -> top placed (stackLevel=1)
        const topByBaseId = new Map<string, PlacedItem>()
        for (const p of placed ?? []) {
            if ((p.stackLevel ?? 0) === 1 && p.stackBaseId) topByBaseId.set(p.stackBaseId, p)
        }

        // ✅ แปลง cm -> world XZ ให้เหมือนกันทุกอย่าง (walls + placed)
        const toWorldXZ = (xCm: number, yCm: number) => {
            let x = xCm * CM_TO_M
            let z = yCm * CM_TO_M
            if (floorIsCentered) {
                x -= areaWm / 2
                z -= areaDm / 2
            }
            return { x, z }
        }

        return (walls ?? []).map((w) => {
            // wall endpoints (world)
            const a = toWorldXZ(w.x1Cm, w.y1Cm)
            const b = toWorldXZ(w.x2Cm, w.y2Cm)
            const A = new Vector3(a.x, 0, a.z)
            const B = new Vector3(b.x, 0, b.z)

            const dir = new Vector3().subVectors(B, A)
            const len = Math.max(0.001, dir.length())
            const ux = dir.clone().normalize() // along wall
            const n = new Vector3(-ux.z, 0, ux.x) // normal
            const mid = new Vector3().addVectors(A, B).multiplyScalar(0.5)
            const yaw = Math.atan2(dir.z, dir.x)

            const t = Math.max(0.01, (w.thicknessCm ?? 10) * CM_TO_M)

            // outer wall shape (ทำเป็น CCW)
            const wallShape = new Shape()
            wallShape.moveTo(-len / 2, 0)
            wallShape.lineTo(len / 2, 0)
            wallShape.lineTo(len / 2, heightM)
            wallShape.lineTo(-len / 2, heightM)
            wallShape.closePath()

            // holes
            for (const base of placed ?? []) {
                if ((base.stackLevel ?? 0) === 1) continue // เจาะจาก base เท่านั้น

                const baseDef = eqById.get(base.equipmentId)
                if (!baseDef) continue

                const fp = footprintCm(baseDef, base.rotationDeg)
                const wM = fp.wCm * CM_TO_M
                const dM = fp.dCm * CM_TO_M

                const tl = toWorldXZ(base.xCm, base.yCm)

                const corners = [
                    new Vector3(tl.x, 0, tl.z),
                    new Vector3(tl.x + wM, 0, tl.z),
                    new Vector3(tl.x + wM, 0, tl.z + dM),
                    new Vector3(tl.x, 0, tl.z + dM),
                ]

                let uMin = Infinity, uMax = -Infinity
                let distMin = Infinity, distMax = -Infinity

                for (const c of corners) {
                    const rel = c.clone().sub(mid)
                    const u = rel.dot(ux)
                    const dist = rel.dot(n)
                    uMin = Math.min(uMin, u)
                    uMax = Math.max(uMax, u)
                    distMin = Math.min(distMin, dist)
                    distMax = Math.max(distMax, dist)
                }

                // overlap along segment + pad ปลาย
                const u0 = clamp(uMin - endPadM, -len / 2, len / 2)
                const u1 = clamp(uMax + endPadM, -len / 2, len / 2)
                if (u1 - u0 <= 0.002) continue

                // ✅ แตะผนังแบบ “slab overlap” (นิ่งสุด)
                // wall slab: dist ∈ [-t/2, +t/2]
                const near = distMin <= t / 2 + gapM && distMax >= -t / 2 - gapM
                if (!near) continue

                const hasTop = topByBaseId.has(base.instanceId)
                const targetH = hasTop ? stackHM : singleHM
                const notchHeight = Math.min(heightM, targetH + gapHM)

                // เจาะ “ทะลุทั้งความสูงที่ต้องการ”
                addRectHoleCW(wallShape, u0, u1, 0, notchHeight)
            }

            const wallGeo = new ExtrudeGeometry(wallShape, {
                depth: t,
                bevelEnabled: false,
            })

            // center thickness
            wallGeo.translate(0, 0, -t / 2)

            return {
                id: w.id,
                mid,
                rotY: -yaw,
                wallGeo,
            }
        })
    }, [
        walls,
        placed,
        equipments,
        areaWm,
        areaDm,
        heightM,
        floorIsCentered,
        gapM,
        gapHM,
        singleHM,
        stackHM,
        endPadM,
    ])

    return (
        <group>
            {items.map((it) => (
                <group key={it.id} position={[it.mid.x, 0, it.mid.z]} rotation={[0, it.rotY, 0]}>
                    <mesh>
                        <primitive object={it.wallGeo} attach="geometry" />
                        <meshStandardMaterial color={color} side={DoubleSide} roughness={0.9} metalness={0} />
                    </mesh>
                </group>
            ))}
        </group>
    )
}