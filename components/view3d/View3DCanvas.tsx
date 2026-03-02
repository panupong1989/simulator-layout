"use client"

import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { useProjectStore } from "@/store/useProjectStore"
import Floor from "@/components/view3d/Floor"
import Equipment3D from "@/components/view3d/Equipment3D"
import type { Equipment, PlacedItem } from "@/lib/types"
import { useEffect, useRef } from "react"
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib"
import Walls3D_NotchPro from "@/components/view3d/Walls3D_NotchPro"
import Walls3D_Cut from "@/components/view3d/Walls3D_Cut"
import Posters3D from "@/components/view3d/Posters3D"

const CM_TO_M = 0.01

export default function View3DCanvas() {
    const controlsRef = useRef<OrbitControlsImpl | null>(null)

    const { area, equipments, placed, walls, posters } = useProjectStore() as any
    const W = ((area?.wCm ?? 500) * CM_TO_M)
    const D = ((area?.dCm ?? 300) * CM_TO_M)

    const eqs = (equipments ?? []) as Equipment[]
    const ps = (placed ?? []) as PlacedItem[]

    const floorIsCentered = true

    const resetToBottomLike2D = () => {
        const c = controlsRef.current
        if (!c) return

        const dist = Math.max(W, D) * 1.2
        c.object.position.set(0.6 * dist, 0.9 * dist, 1.0 * dist)

        // ✅ ถ้าพื้น centered ให้โฟกัส origin
        if (floorIsCentered) c.target.set(0, 0, 0)
        else c.target.set(W / 2, 0, D / 2)

        c.update()
    }

    useEffect(() => {
        console.log("AREA", area)
        console.log("W,D(m)", W, D)
        console.log("WALLS[0..0]", (walls ?? []).slice(0, 1))
        console.log("PLACED[0..1]", (placed ?? []).slice(0, 2))
        console.log("EQUIPMENTS[0..2]", (equipments ?? []).slice(0, 3))

        resetToBottomLike2D()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [area, W, D, walls, placed, equipments])

    return (
        <div className="h-full w-full relative">
            <Canvas camera={{ position: [W * 0.8, Math.max(W, D) * 0.9, D * 0.8], fov: 50 }}>
                <ambientLight intensity={0.7} />
                <directionalLight position={[5, 10, 5]} intensity={1.0} />

                <Floor w={W} d={D} />

                <Walls3D_NotchPro
                    walls={walls ?? []}
                    placed={ps}
                    equipments={eqs}
                    areaWm={W}
                    areaDm={D}
                    heightM={3}
                    floorIsCentered
                    color="#ffffff"
                    gapToWallCm={10}
                    gapHeightCm={10}
                    notchSingleHeightCm={100}
                    notchStackHeightCm={190}
                    endPadCm={5}
                />

                <Posters3D
                    posters={posters ?? []}
                    walls={walls ?? []}
                    areaWm={W}
                    areaDm={D}
                    floorIsCentered
                    wallOutOffsetM={0.02}   // ดันออกจากผนังเพิ่มนิด กันจม
                    centerHeightM={1.45}
                />

                {ps.map((p: PlacedItem) => {
                    const def = eqs.find((e: Equipment) => e.id === p.equipmentId)
                    if (!def) return null

                    let baseH = 0
                    let renderP: PlacedItem = p

                    if ((p.stackLevel ?? 0) === 1) {
                        const base = p.stackBaseId ? ps.find((q: PlacedItem) => q.instanceId === p.stackBaseId) : null
                        const baseDef = base ? eqs.find((e: Equipment) => e.id === base.equipmentId) : null

                        if (base && baseDef) {
                            baseH = baseDef.hCm * CM_TO_M
                            renderP = { ...p, xCm: base.xCm, yCm: base.yCm }
                        } else {
                            baseH = 0.005
                        }
                    }

                    return (
                        <Equipment3D
                            key={p.instanceId}
                            placed={renderP}
                            def={def}
                            baseHeight={baseH}
                            areaWm={W}
                            areaDm={D}
                        />
                    )
                })}

                <OrbitControls ref={controlsRef} enableRotate enableZoom enablePan />
            </Canvas>

            <div className="absolute top-16 right-4 z-10">
                <button
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-[#0b3a64] text-white hover:bg-[#0a3357] border border-white/20"
                    onClick={resetToBottomLike2D}
                >
                    Reset View
                </button>
            </div>
        </div>
    )
}
