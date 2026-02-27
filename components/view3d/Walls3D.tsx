"use client"

import { useMemo } from "react"
import { Vector3, DoubleSide } from "three"

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
    areaWm: number
    areaDm: number
    heightM?: number
    floorIsCentered?: boolean
    opacity?: number
    color?: string
}

export default function Walls3D({
    walls,
    areaWm,
    areaDm,
    heightM = 3,
    floorIsCentered = true,
    opacity = 1,              // ✅ ทึบเป็นค่าเริ่มต้น
    color = "#ffffff",
}: Props) {
    const items = useMemo(() => {
        return walls.map((w) => {
            const a = new Vector3(w.x1Cm * CM_TO_M, 0, w.y1Cm * CM_TO_M)
            const b = new Vector3(w.x2Cm * CM_TO_M, 0, w.y2Cm * CM_TO_M)

            if (floorIsCentered) {
                a.x -= areaWm / 2
                a.z -= areaDm / 2
                b.x -= areaWm / 2
                b.z -= areaDm / 2
            }

            const dir = new Vector3().subVectors(b, a)
            const len = dir.length()
            const safeLen = Math.max(0.001, len)

            const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5)
            const yaw = Math.atan2(dir.z, dir.x)

            // thickness (m)
            const t = Math.max(0.02, (w.thicknessCm ?? 10) * CM_TO_M) // ✅ กันบางเกิน

            // ยกให้ฐานติดพื้น
            const y = heightM / 2 + 0.001

            return {
                id: w.id,
                pos: [mid.x, y, mid.z] as const,
                rot: [0, -yaw, 0] as const,
                size: [safeLen, heightM, t] as const,
            }
        })
    }, [walls, areaWm, areaDm, heightM, floorIsCentered])

    const isTransparent = opacity < 1

    return (
        <group>
            {items.map((it) => (
                <mesh
                    key={it.id}
                    position={it.pos}
                    rotation={it.rot}
                    castShadow
                    receiveShadow
                >
                    <boxGeometry args={it.size} />
                    <meshStandardMaterial
                        color={color}
                        side={DoubleSide}
                        transparent={isTransparent}
                        opacity={opacity}
                        roughness={0.95}
                        metalness={0}
                        polygonOffset
                        polygonOffsetFactor={-1}
                        polygonOffsetUnits={-1}
                    />
                </mesh>
            ))}
        </group>
    )
}