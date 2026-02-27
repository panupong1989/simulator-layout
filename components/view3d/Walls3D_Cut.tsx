"use client"

import { useMemo } from "react"
import { Shape, Path, ExtrudeGeometry, Vector3, DoubleSide } from "three"
import type { PlacedItem, Equipment } from "@/lib/types"

const CM_TO_M = 0.01

export type WallItem = {
    id: string
    x1Cm: number
    y1Cm: number
    x2Cm: number
    y2Cm: number
    thicknessCm: number
}

type Props = {
    walls: WallItem[]
    placed: PlacedItem[]
    equipments: Equipment[]
    areaWm: number
    areaDm: number
    heightM?: number
    floorIsCentered?: boolean

    gapCm?: number
    notchDepthCm?: number

    notchSingleHeightCm?: number // 105
    notchStackHeightCm?: number  // 210

    color?: string
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

type UInterval = { u0: number; u1: number; h: number }

// ทำ holes ไม่ให้ overlap กัน (กัน shape triangulation งอ ๆ)
function intervalsToSegments(intervals: UInterval[]) {
    if (intervals.length === 0) return [] as Array<{ u0: number; u1: number; h: number }>

    const pts: number[] = []
    for (const it of intervals) pts.push(it.u0, it.u1)
    pts.sort((a, b) => a - b)

    const uniq: number[] = []
    for (const p of pts) if (uniq.length === 0 || Math.abs(uniq[uniq.length - 1] - p) > 1e-6) uniq.push(p)

    const segs: Array<{ u0: number; u1: number; h: number }> = []
    for (let i = 0; i < uniq.length - 1; i++) {
        const a = uniq[i]
        const b = uniq[i + 1]
        if (b - a <= 1e-6) continue
        const mid = (a + b) / 2

        let maxH = 0
        for (const it of intervals) {
            if (mid >= it.u0 - 1e-9 && mid <= it.u1 + 1e-9) maxH = Math.max(maxH, it.h)
        }
        if (maxH > 0) segs.push({ u0: a, u1: b, h: maxH })
    }

    // merge adjacent with same height
    const merged: typeof segs = []
    for (const s of segs) {
        const last = merged[merged.length - 1]
        if (last && Math.abs(last.h - s.h) < 1e-6 && Math.abs(last.u1 - s.u0) < 1e-6) last.u1 = s.u1
        else merged.push({ ...s })
    }
    return merged
}

export default function Walls3D_Cut({
    walls,
    placed,
    equipments,
    areaWm,
    areaDm,
    heightM = 3,
    floorIsCentered = true,
    gapCm = 10,
    notchDepthCm = 10,
    notchSingleHeightCm = 105,
    notchStackHeightCm = 210,
    color = "#ffffff",
}: Props) {
    const gapM = gapCm * CM_TO_M
    const notchDepthM = notchDepthCm * CM_TO_M
    const notchH1M = (notchSingleHeightCm + gapCm) * CM_TO_M // 105+10
    const notchH2M = (notchStackHeightCm + gapCm) * CM_TO_M  // 210+10

    const wallMeshes = useMemo(() => {
        const toWorldXZ = (xCm: number, yCm: number) => {
            let x = xCm * CM_TO_M
            let z = yCm * CM_TO_M
            if (floorIsCentered) {
                x -= areaWm / 2
                z -= areaDm / 2
            }
            return { x, z }
        }

        // stack detector: baseId has a top
        const hasTop = new Set<string>()
        for (const p of placed ?? []) {
            if ((p.stackLevel ?? 0) === 1 && p.stackBaseId) hasTop.add(p.stackBaseId)
        }

        // use BASE items only (L1) => 1 column
        const baseRects = (placed ?? [])
            .filter((p) => (p.stackLevel ?? 0) === 0)
            .map((p) => {
                const def = equipments.find((e) => e.id === p.equipmentId)
                if (!def) return null
                const fp = footprintCm(def, p.rotationDeg)
                const a = toWorldXZ(p.xCm, p.yCm)
                const wM = fp.wCm * CM_TO_M
                const dM = fp.dCm * CM_TO_M

                return {
                    id: p.instanceId,
                    // AABB expanded by gap (ใช้ตัดสิน “แตะผนัง”)
                    minX: a.x - gapM,
                    maxX: a.x + wM + gapM,
                    minZ: a.z - gapM,
                    maxZ: a.z + dM + gapM,

                    // center (ใช้เลือกฝั่งผนัง)
                    cx: a.x + wM / 2,
                    cz: a.z + dM / 2,

                    notchH: hasTop.has(p.instanceId) ? notchH2M : notchH1M,
                }
            })
            .filter(Boolean) as Array<{
                id: string
                minX: number; maxX: number; minZ: number; maxZ: number
                cx: number; cz: number
                notchH: number
            }>

        // AABB overlap with wall AABB expanded
        const rectOverlapsWallAabb = (
            r: { minX: number; maxX: number; minZ: number; maxZ: number },
            ax: number, az: number, bx: number, bz: number,
            t: number
        ) => {
            const minWX = Math.min(ax, bx) - t / 2 - gapM
            const maxWX = Math.max(ax, bx) + t / 2 + gapM
            const minWZ = Math.min(az, bz) - t / 2 - gapM
            const maxWZ = Math.max(az, bz) + t / 2 + gapM
            return r.maxX > minWX && r.minX < maxWX && r.maxZ > minWZ && r.minZ < maxWZ
        }

        return (walls ?? []).map((w) => {
            const a = toWorldXZ(w.x1Cm, w.y1Cm)
            const b = toWorldXZ(w.x2Cm, w.y2Cm)

            const dx = b.x - a.x
            const dz = b.z - a.z
            const len = Math.max(0.001, Math.hypot(dx, dz))
            const rotY = Math.atan2(dz, dx)

            const t = Math.max(0.01, (w.thicknessCm ?? 10) * CM_TO_M)
            const effectiveNotch = Math.min(notchDepthM, Math.max(0.001, t - 0.002))

            const ux = dx / len
            const uz = dz / len
            const nx = -uz
            const nz = ux

            // --- decide which side is "front" (ฝั่งที่เครื่องอยู่) ---
            // signed distance of center to wall line in local normal
            const sideVotes: number[] = []
            for (const r of baseRects) {
                if (!rectOverlapsWallAabb(r, a.x, a.z, b.x, b.z, t)) continue
                const vx = r.cx - a.x
                const vz = r.cz - a.z
                const lz = vx * nx + vz * nz
                sideVotes.push(lz)
            }
            const frontSign = sideVotes.length === 0
                ? 1
                : (sideVotes.reduce((s, v) => s + v, 0) >= 0 ? 1 : -1)

            // ===== 1) Back slab (ถอยเข้าไปแล้ว) =====
            const backT = Math.max(0.001, t - effectiveNotch)

            const backShape = new Shape()
            backShape.moveTo(0, 0)
            backShape.lineTo(len, 0)
            backShape.lineTo(len, heightM)
            backShape.lineTo(0, heightM)
            backShape.closePath()

            const backGeo = new ExtrudeGeometry(backShape, { depth: backT, bevelEnabled: false })
            // center thickness at z=0 then shift so front face = t/2 - notch (ฝั่ง front)
            backGeo.translate(0, 0, -backT / 2)
            // shift whole slab toward back by notch/2 on front side
            backGeo.translate(0, 0, -frontSign * (effectiveNotch / 2))

            // ===== 2) Front cap (อยู่ตำแหน่งเดิม แต่ถูกเจาะ holes) =====
            const capShape = new Shape()
            capShape.moveTo(0, 0)
            capShape.lineTo(len, 0)
            capShape.lineTo(len, heightM)
            capShape.lineTo(0, heightM)
            capShape.closePath()

            const intervals: UInterval[] = []

            for (const r of baseRects) {
                if (!rectOverlapsWallAabb(r, a.x, a.z, b.x, b.z, t)) continue

                // project rect corners to u
                const corners = [
                    { x: r.minX, z: r.minZ },
                    { x: r.maxX, z: r.minZ },
                    { x: r.maxX, z: r.maxZ },
                    { x: r.minX, z: r.maxZ },
                ]
                let uMin = Infinity
                let uMax = -Infinity
                for (const c of corners) {
                    const vx = c.x - a.x
                    const vz = c.z - a.z
                    const u = vx * ux + vz * uz
                    uMin = Math.min(uMin, u)
                    uMax = Math.max(uMax, u)
                }
                uMin = clamp(uMin, 0, len)
                uMax = clamp(uMax, 0, len)
                if (uMax - uMin <= 0.001) continue

                intervals.push({ u0: uMin, u1: uMax, h: Math.min(heightM, r.notchH) })
            }

            const segs = intervalsToSegments(intervals)

            for (const s of segs) {
                const hole = new Path()
                hole.moveTo(s.u0, 0)
                hole.lineTo(s.u1, 0)
                hole.lineTo(s.u1, s.h)
                hole.lineTo(s.u0, s.h)
                hole.closePath()
                capShape.holes.push(hole)
            }

            const capGeo = new ExtrudeGeometry(capShape, { depth: effectiveNotch, bevelEnabled: false })
            // center cap then move it to front face area: [t/2 - notch .. t/2] on frontSign side
            capGeo.translate(0, 0, -effectiveNotch / 2)
            capGeo.translate(0, 0, frontSign * (t / 2 - effectiveNotch / 2))

            return {
                id: w.id,
                pos: [a.x, 0, a.z] as const,
                rot: [0, rotY, 0] as const,
                backGeo,
                capGeo,
            }
        })
    }, [
        walls, placed, equipments,
        areaWm, areaDm, heightM,
        floorIsCentered, gapM,
        notchDepthM, notchH1M, notchH2M
    ])

    return (
        <group>
            {wallMeshes.map((m) => (
                <group key={m.id} position={m.pos} rotation={m.rot}>
                    {/* back slab */}
                    <mesh geometry={m.backGeo}>
                        <meshStandardMaterial color={color} side={DoubleSide} roughness={0.9} metalness={0} />
                    </mesh>

                    {/* front cap (มี holes) */}
                    <mesh geometry={m.capGeo}>
                        <meshStandardMaterial color={color} side={DoubleSide} roughness={0.9} metalness={0} />
                    </mesh>
                </group>
            ))}
        </group>
    )
}