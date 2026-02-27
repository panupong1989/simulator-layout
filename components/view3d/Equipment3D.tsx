"use client"

import { useMemo } from "react"
import { useGLTF } from "@react-three/drei"
import { Box3, Vector3, Group, MathUtils } from "three"
import type { Equipment, PlacedItem } from "@/lib/types"

const CM_TO_M = 0.01

type Props = {
    placed: PlacedItem
    def: Equipment
    baseHeight?: number // meters
    areaWm: number
    areaDm: number
}

export default function Equipment3D({ placed, def, baseHeight = 0, areaWm, areaDm }: Props) {
    const url = def.modelUrl
    if (!url) return null

    const gltf = useGLTF(url)

    // clone กันการ share transform/scale ระหว่าง instance
    const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])

    // --- AutoFit: คำนวณ bbox ของโมเดล แล้ว scale ให้เท่ากับ def (cm) ---
    const { fitScale, offset } = useMemo(() => {
        const bbox = new Box3().setFromObject(scene)
        const size = new Vector3()
        const center = new Vector3()
        bbox.getSize(size)
        bbox.getCenter(center)

        // ขนาดที่ "ต้องการ" (เมตร)
        const wantX = def.wCm * CM_TO_M
        const wantY = def.hCm * CM_TO_M
        const wantZ = def.dCm * CM_TO_M

        // กันหารศูนย์
        const sx = size.x > 0 ? wantX / size.x : 1
        const sy = size.y > 0 ? wantY / size.y : 1
        const sz = size.z > 0 ? wantZ / size.z : 1

        // ใช้ uniform scale เพื่อไม่บิดรูป (เลือกตัวที่ทำให้ "ไม่เกินกรอบ")
        const s = Math.min(sx, sy, sz)

        // offset ให้ “วางบนพื้น” (minY -> 0) และ “center XZ”
        const minY = bbox.min.y
        const off = new Vector3(
            -center.x * s,
            -minY * s,
            -center.z * s
        )

        return { fitScale: s, offset: off }
    }, [scene, def.wCm, def.dCm, def.hCm])

    // --- world position ---
    // ให้ world origin อยู่ “มุมซ้ายบนของพื้นที่” แล้ววางด้วย top-left -> center
    const rot = ((placed.rotationDeg ?? 0) % 360 + 360) % 360
    const swap = rot === 90 || rot === 270
    const fpW = swap ? def.dCm : def.wCm
    const fpD = swap ? def.wCm : def.dCm

    const x = (placed.xCm + fpW / 2) * CM_TO_M
    const z = (placed.yCm + fpD / 2) * CM_TO_M

    // หมุนตาม 2D (clockwise) -> three.js ปกติ CCW เลยใส่ลบ
    const rotY = -MathUtils.degToRad(placed.rotationDeg ?? 0)

    // ✅ ถ้า Floor ของคุณอยู่ "กึ่งกลางฉาก" ต้อง shift ด้วย -W/2, -D/2
    // ถ้า Floor อยู่ "มุมซ้ายบนเป็น 0,0" ให้ปิดบรรทัดนี้
    const floorIsCentered = true
    const worldX = floorIsCentered ? x - areaWm / 2 : x
    const worldZ = floorIsCentered ? z - areaDm / 2 : z

    return (
        <group position={[worldX, baseHeight, worldZ]} rotation={[0, rotY, 0]}>
            <group position={offset} scale={fitScale}>
                <primitive object={scene} />
            </group>
        </group>
    )
}
