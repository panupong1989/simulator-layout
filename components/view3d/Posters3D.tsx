"use client"

import { useMemo } from "react"
import * as THREE from "three"
import { useTexture } from "@react-three/drei"
import type { WallItem } from "@/store/useProjectStore" // หรือย้าย type ไป lib/types รวม
import type { PosterItem } from "@/lib/posters"
import { POSTER_SPECS } from "@/lib/posters"

const CM_TO_M = 0.01

export default function Posters3D(props: {
    posters: PosterItem[]
    walls: WallItem[]
    areaWm: number
    areaDm: number
    floorIsCentered?: boolean
    wallOutOffsetM?: number // ดันออกจากผนังกันจม
    centerHeightM?: number  // ระดับกึ่งกลางโปสเตอร์
}) {
    const {
        posters,
        walls,
        areaWm,
        areaDm,
        floorIsCentered = true,
        wallOutOffsetM = 0.01,
        centerHeightM = 1.45,
    } = props

    const texRule = useTexture("/posters/rule.png")
    const texPrice = useTexture("/posters/price.png")
    const texHowto = useTexture("/posters/howto.png")

    const texByKey = useMemo(() => ({
        rule: texRule,
        price: texPrice,
        howto: texHowto,
    }), [texRule, texPrice, texHowto])

    return (
        <>
            {posters.map((p) => {
                const w = walls.find((x) => x.id === p.wallId)
                if (!w) return null

                // point on wall in CM
                const xCm = w.x1Cm + (w.x2Cm - w.x1Cm) * p.t
                const yCm = w.y1Cm + (w.y2Cm - w.y1Cm) * p.t

                // convert to meters + floor centering
                const xM0 = xCm * CM_TO_M
                const zM0 = yCm * CM_TO_M
                const xM = floorIsCentered ? xM0 - areaWm / 2 : xM0
                const zM = floorIsCentered ? zM0 - areaDm / 2 : zM0

                // wall direction in XZ
                const ax = (w.x2Cm - w.x1Cm) * CM_TO_M
                const az = (w.y2Cm - w.y1Cm) * CM_TO_M
                const len = Math.hypot(ax, az) || 1

                // normal (perp)
                let nx = -az / len
                let nz = ax / len

                // ✅ สำคัญ: ทำให้ “ด้านนอก” ตรงกับ 2D (กลับด้าน 1 ครั้ง)
                nx *= -1
                nz *= -1

                // ถ้ามี flip ของโปสเตอร์ด้วย
                const flip = p.flip ? -1 : 1
                nx *= flip
                nz *= flip

                // position slightly out of wall
                const px = xM + nx * wallOutOffsetM
                const pz = zM + nz * wallOutOffsetM

                // face normal
                let rotY = Math.atan2(nx, nz)

                // ✅ size: ใช้ค่าจาก item ก่อน ถ้าไม่มีค่อย fallback ไป POSTER_SPECS
                const spec = POSTER_SPECS[p.imageKey]
                const wM = spec.wCm * CM_TO_M
                const hM = spec.hCm * CM_TO_M

                const map = (texByKey as any)[p.imageKey]
                if (map) {
                    map.colorSpace = THREE.SRGBColorSpace
                    map.needsUpdate = true
                }

                return (
                    <mesh key={p.id} position={[px, centerHeightM, pz]} rotation={[0, rotY, 0]}>
                        <planeGeometry args={[wM, hM]} />
                        <meshBasicMaterial
                            map={map}
                            transparent
                            side={THREE.FrontSide}
                            depthTest={false}      // ✅ กันโดนผนังบัง
                            depthWrite={false}
                        />
                    </mesh>
                )
            })}
        </>
    )
}