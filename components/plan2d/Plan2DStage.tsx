"use client"

import type React from "react"
import { Stage, Layer, Rect, Line, Text, Group, Circle } from "react-konva"
import { useMemo, useState, useEffect, useRef } from "react"
import type Konva from "konva"
import { useProjectStore } from "@/store/useProjectStore"
import type { Equipment, PlacedItem } from "@/lib/types"
import { edgeSnapNearCm } from "@/lib/edgeSnapNear"
import { useCallback } from "react"
import { Poster2D } from "@/components/plan2d/Poster2D"
import type { PosterItem } from "@/lib/posters"
import { POSTER_SPECS } from "@/lib/posters"

// ============================
// TUNING
// ============================
const PX_PER_CM = 2

const SNAP_STEP_CM = 1
const GRID_CM = 5
const MAJOR_CM = 10
const SNAP_RADIUS_CM = 1.2

// Label UI
const LABEL_PAD = 8
const TITLE_FS = 14
const BODY_FS = 12
const LABEL_BG = "#ffffffcc"
const LABEL_STROKE = "#111827"
const LABEL_RADIUS = 6

// Arrow UI
const ARROW_LEN = 18
const ARROW_HEAD = 6
const ARROW_STROKE = 2
const ARROW_GAP = 10

const STACK_SNAP_RADIUS_CM = 12
const ZOOMS = [20, 40, 60, 80, 100, 120] as const

// Wall UI
const WALL_DEFAULT_THICK_CM = 10
const WALL_HIT_STROKE_PX = 18 // เพิ่ม hit area ให้คลิกง่าย
const WALL_HANDLE_R_PX = 7

// ============================
// Types (local for this file)
// ============================
type ToolMode = "select" | "wall"

type WallItem = {
    id: string
    x1Cm: number
    y1Cm: number
    x2Cm: number
    y2Cm: number
    thicknessCm: number
}

// ============================
// Helpers
// ============================
function snapStep(vCm: number, stepCm: number) {
    return Math.round(vCm / stepCm) * stepCm
}
function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(n, b))
}
function normRot(rotDeg?: number) {
    return (((rotDeg ?? 0) % 360) + 360) % 360
}
function footprintCm(def: Equipment, rotDeg?: number) {
    const r = normRot(rotDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}
function estimateTextWidthPx(text: string, fontSize: number) {
    return text.length * fontSize * 0.62
}

function stackSnapToNearestL1Cm(args: {
    xCm: number
    yCm: number
    placed: PlacedItem[]
    selfId: string
    radiusCm: number
}): { xCm: number; yCm: number; snapped: boolean; baseId: string | null } {
    const { xCm, yCm, placed, selfId, radiusCm } = args
    let bestDist = radiusCm + 1
    let bestX = xCm
    let bestY = yCm
    let bestId: string | null = null

    for (const p of placed) {
        if (p.instanceId === selfId) continue
        if ((p.stackLevel ?? 0) !== 0) continue
        const dist = Math.hypot(p.xCm - xCm, p.yCm - yCm)
        if (dist <= radiusCm && dist < bestDist) {
            bestDist = dist
            bestX = p.xCm
            bestY = p.yCm
            bestId = p.instanceId
        }
    }
    return { xCm: bestX, yCm: bestY, snapped: !!bestId, baseId: bestId }
}

function placedFootprintCm(p: PlacedItem, equipments: Equipment[]) {
    const def = equipments.find((e) => e.id === p.equipmentId)
    if (!def) return null
    const r = normRot(p.rotationDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}

function resolveNoOverlapCm(args: {
    xCm: number
    yCm: number
    moving: { wCm: number; dCm: number }
    movingStackLevel: 0 | 1
    placed: PlacedItem[]
    equipments: Equipment[]
    selfId: string
    areaW: number
    areaD: number
    maxIter?: number
}): { xCm: number; yCm: number } {
    const { xCm, yCm, moving, placed, equipments, selfId, areaW, areaD, maxIter = 8, movingStackLevel } = args
    if (movingStackLevel === 1) return { xCm, yCm }

    let x = xCm
    let y = yCm

    for (let iter = 0; iter < maxIter; iter++) {
        let moved = false

        const aL = x
        const aR = x + moving.wCm
        const aT = y
        const aB = y + moving.dCm

        for (const p of placed) {
            if (p.instanceId === selfId) continue
            const fpB = placedFootprintCm(p, equipments)
            if (!fpB) continue

            const bL = p.xCm
            const bR = p.xCm + fpB.wCm
            const bT = p.yCm
            const bB = p.yCm + fpB.dCm

            const overlapX = Math.min(aR, bR) - Math.max(aL, bL)
            const overlapY = Math.min(aB, bB) - Math.max(aT, bT)
            if (overlapX <= 0 || overlapY <= 0) continue

            const pushLeft = bL - aR
            const pushRight = bR - aL
            const pushUp = bT - aB
            const pushDown = bB - aT

            const dx = Math.abs(pushLeft) < Math.abs(pushRight) ? pushLeft : pushRight
            const dy = Math.abs(pushUp) < Math.abs(pushDown) ? pushUp : pushDown

            if (Math.abs(dx) < Math.abs(dy)) x += dx
            else y += dy

            const maxX = areaW - moving.wCm
            const maxY = areaD - moving.dCm
            x = clamp(x, 0, maxX)
            y = clamp(y, 0, maxY)

            moved = true
            break
        }

        if (!moved) break
    }

    return { xCm: x, yCm: y }
}

type ArrowGeom = { shaft: number[]; head: number[] }

function buildArrowBelowLabel(args: {
    labelX: number
    labelY: number
    labelW: number
    labelH: number
    rotDeg: number
    footH: number
    arrowLen: number
    arrowHead: number
}): ArrowGeom {
    const { labelX, labelY, labelW, labelH, rotDeg, footH, arrowLen, arrowHead } = args

    const cx = labelX + labelW / 2
    const labelBottom = labelY + labelH
    const zoneTop = labelBottom + 8
    const zoneBottom = footH - 8
    const zoneH = Math.max(0, zoneBottom - zoneTop)
    const cy = zoneH >= 10 ? (zoneTop + zoneBottom) / 2 : labelBottom + 12

    const r = (((rotDeg % 360) + 360) % 360)
    let dx = 0,
        dy = 0
    if (r === 0) {
        dx = 0
        dy = 1
    } else if (r === 90) {
        dx = -1
        dy = 0
    } else if (r === 180) {
        dx = 0
        dy = -1
    } else if (r === 270) {
        dx = 1
        dy = 0
    } else {
        const rad = (Math.PI / 180) * (r + 90)
        dx = Math.cos(rad)
        dy = Math.sin(rad)
    }

    const maxLenVertical = zoneH >= 10 ? Math.max(8, zoneH / 2 - 2) : 10
    const len = Math.abs(dy) > 0.5 ? Math.min(arrowLen, maxLenVertical) : arrowLen

    const half = len / 2
    const x1 = cx - dx * half
    const y1 = cy - dy * half
    const x2 = cx + dx * half
    const y2 = cy + dy * half

    const L = Math.hypot(x2 - x1, y2 - y1) || 1
    const ux = (x2 - x1) / L
    const uy = (y2 - y1) / L
    const px = -uy
    const py = ux

    const head = Math.min(arrowHead, len * 0.45)
    const hx1 = x2 - ux * head + px * (head * 0.8)
    const hy1 = y2 - uy * head + py * (head * 0.8)
    const hx2 = x2 - ux * head - px * (head * 0.8)
    const hy2 = y2 - uy * head - py * (head * 0.8)

    return {
        shaft: [x1, y1, x2, y2],
        head: [x2, y2, hx1, hy1, x2, y2, hx2, hy2],
    }
}

function projectTOnWall(xCm: number, yCm: number, w: WallItem) {
    const vx = w.x2Cm - w.x1Cm
    const vy = w.y2Cm - w.y1Cm
    const wx = xCm - w.x1Cm
    const wy = yCm - w.y1Cm
    const vv = vx * vx + vy * vy
    const t = vv <= 1e-9 ? 0 : (wx * vx + wy * vy) / vv
    return Math.max(0, Math.min(1, t))
}

function nearestWallForPoint(xCm: number, yCm: number, walls: WallItem[]) {
    let best: { wallId: string; t: number; dist2: number } | null = null
    for (const w of walls) {
        const vx = w.x2Cm - w.x1Cm
        const vy = w.y2Cm - w.y1Cm
        const wx = xCm - w.x1Cm
        const wy = yCm - w.y1Cm
        const vv = vx * vx + vy * vy
        const tRaw = vv <= 1e-9 ? 0 : (wx * vx + wy * vy) / vv
        const t = Math.max(0, Math.min(1, tRaw))
        const px = w.x1Cm + vx * t
        const py = w.y1Cm + vy * t
        const dx = xCm - px
        const dy = yCm - py
        const dist2 = dx * dx + dy * dy
        if (!best || dist2 < best.dist2) best = { wallId: w.id, t, dist2 }
    }
    return best
}

function clamp01(x: number) {
    return Math.max(0, Math.min(1, x))
}

function tOnWallFromPointCm(w: { x1Cm: number; y1Cm: number; x2Cm: number; y2Cm: number }, xCm: number, yCm: number) {
    const vx = w.x2Cm - w.x1Cm
    const vy = w.y2Cm - w.y1Cm
    const wx = xCm - w.x1Cm
    const wy = yCm - w.y1Cm
    const vv = vx * vx + vy * vy
    const t = vv <= 1e-9 ? 0 : (wx * vx + wy * vy) / vv
    return clamp01(t)
}

export default function Plan2DStage() {

    const stageRef = useRef<Konva.Stage | null>(null)
    const wrapRef = useRef<HTMLDivElement | null>(null)

    const s = useProjectStore() as any

    const posters = useProjectStore((s) => s.posters) as PosterItem[]
    const posterTool = s.posterTool ?? null
    const setPosterTool = s.setPosterTool ?? (() => { })
    const addPosterOnWall = s.addPosterOnWall ?? (() => { })
    const updatePosterT = s.updatePosterT ?? (() => { })
    const removePoster = s.removePoster ?? (() => { })
    const selectedPosterId = s.selectedPosterId ?? null
    const selectPoster = s.selectPoster ?? (() => { })
    const flipPoster = s.flipPoster ?? (() => { })

    const walls: WallItem[] = s.walls ?? []
    const selectedWallId: string | null = s.selectedWallId ?? null
    const tool: ToolMode = s.tool ?? "select"
    const setTool = s.setTool ?? (() => { })
    const addWall = s.addWall ?? (() => { })
    const updateWall = s.updateWall ?? (() => { })
    const removeWall = s.removeWall ?? (() => { })
    const selectWall = s.selectWall ?? (() => { })

    const layouts = s.layouts ?? []
    const saveLayout = s.saveLayout ?? (() => { })
    const loadLayout = s.loadLayout ?? (() => { })
    const deleteLayout = s.deleteLayout ?? (() => { })
    const [layoutName, setLayoutName] = useState("")
    const [selectedLayoutId, setSelectedLayoutId] = useState<string>("")
    const [showList, setShowList] = useState(false)

    const {
        area,
        setArea,
        equipments,
        placed,
        selectedId,
        addPlaced,
        movePlaced,
        rotatePlaced,
        removePlaced,
        select,
        toggleStack,

    } = useProjectStore() as unknown as {
        area: { wCm: number; dCm: number }
        setArea: (a: { wCm: number; dCm: number }) => void
        equipments: Equipment[]
        placed: PlacedItem[]
        selectedId: string | null
        addPlaced: (equipmentId: string, xCm: number, yCm: number) => void
        movePlaced: (instanceId: string, xCm: number, yCm: number, patch?: any) => void
        rotatePlaced: (instanceId: string) => void
        removePlaced: (instanceId: string) => void
        select: (id: string | null) => void
        toggleStack: (instanceId: string) => void

        walls: WallItem[]
        selectedWallId: string | null
        tool: ToolMode
        setTool: (t: ToolMode) => void
        addWall: (w: WallItem) => void
        updateWall: (id: string, patch: Partial<WallItem>) => void
        removeWall: (id: string) => void
        selectWall: (id: string | null) => void
        flipPoster: (id: string) => void
    }

    const [zoomPct, setZoomPct] = useState<(typeof ZOOMS)[number]>(100)
    const zoom = zoomPct / 100

    // world scale
    const cmToPx = (v: number) => v * PX_PER_CM * zoom
    const pxToCm = (v: number) => v / (PX_PER_CM * zoom)

    // UI scale
    const ui = zoom
    const u = (v: number) => v * ui

    const stageW = cmToPx(area.wCm)
    const stageH = cmToPx(area.dCm)

    const canActEquip = !!selectedId
    const canActWall = !!selectedWallId
    const canActPoster = !!selectedPosterId

    // ----------------------------
    // Area input
    // ----------------------------
    const [wInput, setWInput] = useState(String(area.wCm))
    const [dInput, setDInput] = useState(String(area.dCm))

    useEffect(() => {
        setWInput(String(area.wCm))
        setDInput(String(area.dCm))
    }, [area.wCm, area.dCm])


    const deleteSelected = useCallback(() => {
        if (selectedPosterId) {
            removePoster(selectedPosterId)
            selectPoster(null)
            return
        }
        if (selectedWallId) {
            removeWall(selectedWallId)
            selectWall(null)
            return
        }
        if (selectedId) removePlaced(selectedId)
    }, [selectedPosterId, removePoster, selectPoster, selectedWallId, selectedId, removeWall, selectWall, removePlaced])

    useEffect(() => {
        const onKeyDown = (ev: KeyboardEvent) => {
            const el = ev.target as HTMLElement | null
            const isTyping =
                el &&
                (el.tagName === "INPUT" ||
                    el.tagName === "TEXTAREA" ||
                    (el as any).isContentEditable)

            if (isTyping) return // ✅ ปล่อยให้ input จัดการ Backspace เอง

            if (ev.key === "Delete" || ev.key === "Backspace") {
                ev.preventDefault()
                deleteSelected()
            }
            if (ev.key === "Escape") {
                setWallStart(null)
                setWallEnd(null)
                setDragWall(null)
            }
        }

        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [deleteSelected])

    const applyArea = () => {
        const w = Math.max(1, Math.round(Number(wInput) || area.wCm))
        const d = Math.max(1, Math.round(Number(dInput) || area.dCm))
        setArea({ wCm: w, dCm: d })
    }

    // ----------------------------
    // Drag & Drop equipment
    // ----------------------------
    const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
        e.preventDefault()

        const stage = stageRef.current
        const wrap = wrapRef.current
        if (!stage || !wrap) return

        const rect = wrap.getBoundingClientRect()
        const localX = e.clientX - rect.left + wrap.scrollLeft
        const localY = e.clientY - rect.top + wrap.scrollTop
        const xCm = pxToCm(localX)
        const yCm = pxToCm(localY)

        // ✅ 1) Poster drop
        const posterKey = e.dataTransfer.getData("posterKey") as any
        if (posterKey) {
            const hit = nearestWallForPoint(xCm, yCm, walls)
            if (hit) {
                // กันหลุด wall มากไป: ระยะห่าง <= 20cm ค่อยให้วาง (ปรับได้)
                if (hit.dist2 <= 20 * 20) addPosterOnWall(hit.wallId, hit.t, posterKey)
            }
            return
        }

        // ✅ 2) Equipment drop (เดิม)
        const equipmentId = e.dataTransfer.getData("equipmentId")
        if (!equipmentId) return
        addPlaced(equipmentId, snapStep(xCm, SNAP_STEP_CM), snapStep(yCm, SNAP_STEP_CM))
    }

    // ----------------------------
    // Grid
    // ----------------------------
    const gridLines = useMemo(() => {
        const lines: React.ReactNode[] = []
        for (let x = 0; x <= area.wCm + 1e-6; x += GRID_CM) {
            const isMajor = Math.abs(x % MAJOR_CM) < 1e-6
            lines.push(
                <Line
                    listening={false}
                    key={`v-${x}`}
                    points={[cmToPx(x), 0, cmToPx(x), stageH]}
                    stroke={isMajor ? "#cbd5e1" : "#e5e7eb"}
                    strokeWidth={isMajor ? 1.5 : 1}
                />
            )
        }
        for (let y = 0; y <= area.dCm + 1e-6; y += GRID_CM) {
            const isMajor = Math.abs(y % MAJOR_CM) < 1e-6
            lines.push(
                <Line
                    listening={false}
                    key={`h-${y}`}
                    points={[0, cmToPx(y), stageW, cmToPx(y)]}
                    stroke={isMajor ? "#cbd5e1" : "#e5e7eb"}
                    strokeWidth={isMajor ? 1.5 : 1}
                />
            )
        }
        return lines
    }, [area.wCm, area.dCm, stageW, stageH])

    // ----------------------------
    // Render order for equipments
    // ----------------------------
    const orderedPlaced = useMemo(() => {
        return [...placed].sort((a, b) => {
            const aL = a.stackLevel ?? 0
            const bL = b.stackLevel ?? 0
            if (aL !== bL) return aL - bL

            const aSel = a.instanceId === selectedId ? 1 : 0
            const bSel = b.instanceId === selectedId ? 1 : 0
            if (aSel !== bSel) return aSel - bSel

            return 0
        })
    }, [placed, selectedId])

    // ----------------------------
    // WALL: draft + endpoint drag
    // ----------------------------
    const [wallStart, setWallStart] = useState<{ xCm: number; yCm: number } | null>(null)
    const [wallEnd, setWallEnd] = useState<{ xCm: number; yCm: number } | null>(null)
    const [dragWall, setDragWall] = useState<{ id: string; which: "a" | "b" } | null>(null)

    const getPointerCmFromStage = (stage: Konva.Stage) => {
        const p = stage.getPointerPosition()
        if (!p) return null
        return {
            xCm: snapStep(pxToCm(p.x), SNAP_STEP_CM),
            yCm: snapStep(pxToCm(p.y), SNAP_STEP_CM),
        }
    }


    // ----------------------------
    // Stage mouse logic (wall tool)
    // ----------------------------
    const onStageMouseDown = (e: any) => {
        const stage = e.target.getStage?.() as Konva.Stage | null
        if (!stage) return
        if (dragWall) return

        const isBg = e.target === stage || e.target?.name?.() === "bg"

        if (tool === "wall") {
            if (!isBg) return // ✅ สำคัญ: คลิกบน wall/equipment ไม่ทำอะไร
            const pt = getPointerCmFromStage(stage)
            if (!pt) return

            if (!wallStart) {
                setWallStart(pt)
                setWallEnd(pt)
            } else {
                addWall({ id: crypto.randomUUID(), x1Cm: wallStart.xCm, y1Cm: wallStart.yCm, x2Cm: wallEnd?.xCm ?? pt.xCm, y2Cm: wallEnd?.yCm ?? pt.yCm, thicknessCm: WALL_DEFAULT_THICK_CM })
                setWallStart(null)
                setWallEnd(null)
            }
            return
        }

        if (isBg) {
            select(null)
            selectWall(null)
        }
    }

    const onStageMouseMove = (e: any) => {
        const stage = e.target.getStage?.() as Konva.Stage | null
        if (!stage) return

        // 1) drag endpoint
        if (dragWall) {
            const pt = getPointerCmFromStage(stage)
            if (!pt) return

            // shift lock axis
            const w = walls.find((x) => x.id === dragWall.id)
            if (!w) return

            let { xCm, yCm } = pt
            const base = dragWall.which === "a" ? { x: w.x2Cm, y: w.y2Cm } : { x: w.x1Cm, y: w.y1Cm }
            if (e.evt?.shiftKey) {
                const dx = Math.abs(xCm - base.x)
                const dy = Math.abs(yCm - base.y)
                if (dx > dy) yCm = base.y
                else xCm = base.x
            }

            if (dragWall.which === "a") {
                updateWall(dragWall.id, { x1Cm: xCm, y1Cm: yCm })
            } else {
                updateWall(dragWall.id, { x2Cm: xCm, y2Cm: yCm })
            }
            return
        }

        // 2) draft preview
        if (tool === "wall" && wallStart) {
            const pt = getPointerCmFromStage(stage)
            if (!pt) return

            let { xCm, yCm } = pt
            if (e.evt?.shiftKey) {
                const dx = Math.abs(xCm - wallStart.xCm)
                const dy = Math.abs(yCm - wallStart.yCm)
                if (dx > dy) yCm = wallStart.yCm
                else xCm = wallStart.xCm
            }

            setWallEnd({ xCm, yCm })
        }
    }

    const onStageMouseUp = () => {
        if (dragWall) setDragWall(null)
    }

    // ----------------------------
    // Toolbar: equipments draggable items
    // ----------------------------
    const addFirst = (eq: Equipment) => addPlaced(eq.id, snapStep(10, SNAP_STEP_CM), snapStep(10, SNAP_STEP_CM))

    // ✅ ต้องมี state เหล่านี้ใน component ก่อน
    // const [showList, setShowList] = useState(false)
    // const [selectedLayoutId, setSelectedLayoutId] = useState("")
    // const layouts = s.layouts ?? []
    // const loadLayout = s.loadLayout ?? (() => {})
    // const deleteLayout = s.deleteLayout ?? (() => {})

    return (
        <div className="h-full w-full flex flex-col">
            {/* TOP BAR (2 rows) */}
            <div
                className="border-b bg-[#0b3a64] text-white relative"
                onMouseDown={() => {
                    if (showList) setShowList(false) // ✅ click นอก panel ให้ปิด
                }}
            >
                {/* ROW 1 */}
                <div className="h-12 flex items-center gap-2 px-3">
                    {/* SAVE */}
                    <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1">
                        <input
                            className="w-44 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/40 outline-none"
                            value={layoutName}
                            onChange={(e) => setLayoutName(e.target.value)}
                            placeholder='ใส่ชื่อไฟล์'
                        />
                        <button
                            className="rounded-md bg-emerald-400 px-3 py-1 text-xs font-bold text-black hover:bg-emerald-500"
                            onClick={() => {
                                saveLayout(layoutName)
                                setLayoutName("")
                            }}
                        >
                            Save
                        </button>
                    </div>

                    {/* LOAD */}
                    <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1">
                        <select
                            className="w-56 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white outline-none"
                            value={selectedLayoutId}
                            onChange={(e) => {
                                const id = e.target.value
                                setSelectedLayoutId(id)
                                if (!id) return
                                loadLayout(id)
                                setSelectedLayoutId("") // ✅ reset เพื่อให้เลือกอันเดิมซ้ำได้
                            }}
                            onMouseDown={(e) => e.stopPropagation()} // ✅ กัน click ปิด showList
                        >
                            <option value="">Load layout...</option>
                            {layouts.map((l: any) => (
                                <option key={l.id} value={l.id} className="text-black">
                                    {l.name}
                                </option>
                            ))}
                        </select>

                        <button
                            className="rounded-md bg-white/20 px-3 py-1 text-xs font-semibold text-white hover:bg-white/30"
                            onMouseDown={(e) => e.stopPropagation()} // ✅ กัน click ปิด showList
                            onClick={() => setShowList((v) => !v)}
                        >
                            List
                        </button>
                    </div>

                    {/* Area */}
                    <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1">
                        <span className="text-xs text-white/80">Area (cm)</span>
                        <input
                            className="w-20 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/40 outline-none"
                            value={wInput}
                            onChange={(e) => setWInput(e.target.value)}
                            placeholder="W"
                            onMouseDown={(e) => e.stopPropagation()}
                        />
                        <span className="text-xs text-white/70">x</span>
                        <input
                            className="w-20 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/40 outline-none"
                            value={dInput}
                            onChange={(e) => setDInput(e.target.value)}
                            placeholder="D"
                            onMouseDown={(e) => e.stopPropagation()}
                        />
                        <button
                            className="rounded-md bg-white px-3 py-1 text-xs font-bold text-[#0b3a64] hover:bg-white/90"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={applyArea}
                        >
                            Apply
                        </button>
                    </div>

                    {/* Zoom */}
                    <div className="flex items-center gap-1 rounded-lg bg-white/10 p-1">
                        {ZOOMS.map((z) => (
                            <button
                                key={z}
                                className={[
                                    "px-2 py-1 rounded-md text-xs font-semibold",
                                    z === zoomPct ? "bg-white text-[#0b3a64]" : "text-white/90 hover:bg-white/10",
                                ].join(" ")}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => setZoomPct(z)}
                            >
                                {z}%
                            </button>
                        ))}
                    </div>

                    {/* Actions */}
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            className={[
                                "px-3 py-1 rounded-md text-xs font-semibold transition",
                                (canActEquip || canActPoster)
                                    ? "bg-white text-[#0b3a64] hover:bg-white/90"
                                    : "bg-white/20 text-white/50 cursor-not-allowed",
                            ].join(" ")}
                            disabled={!(canActEquip || canActPoster)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => {
                                if (selectedPosterId) flipPoster(selectedPosterId)     // ✅ poster rotate/flip
                                else if (selectedId) rotatePlaced(selectedId)          // ✅ equipment rotate
                            }}
                        >
                            Rotate
                        </button>

                        <button
                            className={[
                                "px-3 py-1 rounded-md text-xs font-semibold transition",
                                canActEquip || canActWall ? "bg-red-500 text-white hover:bg-red-600" : "bg-white/20 text-white/50 cursor-not-allowed",
                            ].join(" ")}
                            disabled={!(canActEquip || canActWall)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={deleteSelected}
                        >
                            Delete
                        </button>

                        <button
                            className={[
                                "px-3 py-1 rounded-md text-xs font-semibold transition",
                                canActEquip ? "bg-amber-400 text-black hover:bg-amber-500" : "bg-white/20 text-white/50 cursor-not-allowed",
                            ].join(" ")}
                            disabled={!canActEquip}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => selectedId && toggleStack(selectedId)}
                        >
                            Stack L1/L2
                        </button>
                    </div>
                </div>

                {/* ROW 2 */}
                <div className="h-12 flex items-center gap-2 px-3 pb-2">
                    {/* Tools */}
                    <div className="flex items-center gap-1 rounded-lg bg-white/10 p-1">
                        <button
                            className={[
                                "px-3 py-1 rounded-md text-xs font-semibold",
                                tool === "select" ? "bg-white text-[#0b3a64]" : "hover:bg-white/10",
                            ].join(" ")}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setTool("select")}
                        >
                            Select
                        </button>
                        <button
                            className={[
                                "px-3 py-1 rounded-md text-xs font-semibold",
                                tool === "wall" ? "bg-white text-[#0b3a64]" : "hover:bg-white/10",
                            ].join(" ")}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => {
                                setTool("wall")
                                setWallStart(null)
                                setWallEnd(null)
                            }}
                            title="Click to set start, click again to set end. Hold SHIFT to lock axis."
                        >
                            Wall
                        </button>
                    </div>

                    {/* Equipment palette */}
                    <div className="flex-1 flex items-center gap-2 overflow-x-auto max-w-full">
                        {equipments.map((e) => (
                            <div
                                key={e.id}
                                draggable
                                onDragStart={(ev) => {
                                    ev.dataTransfer.setData("equipmentId", e.id)
                                    ev.dataTransfer.effectAllowed = "copy"
                                }}
                                onDoubleClick={() => addFirst(e)}
                                className="shrink-0 px-3 py-1 rounded-lg bg-white text-[#0b3a64] border border-white/30 hover:bg-white/90 cursor-grab active:cursor-grabbing select-none text-xs font-semibold"
                                title="Drag to canvas (double-click to add)"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                + {e.name}
                            </div>
                        ))}

                        {/* Poster palette group */}
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="text-xs text-white/70 px-2">POSTERS</div>

                            {(["rule", "price", "howto"] as const).map((k) => (
                                <div
                                    key={k}
                                    draggable
                                    onDragStart={(ev) => {
                                        ev.dataTransfer.setData("posterKey", k)
                                        ev.dataTransfer.effectAllowed = "copy"
                                    }}
                                    onClick={() => setPosterTool(k)}
                                    className={[
                                        "shrink-0 px-3 py-1 rounded-lg border border-white/30 cursor-grab active:cursor-grabbing select-none text-xs font-semibold",
                                        posterTool === k ? "bg-amber-300 text-black" : "bg-white text-[#0b3a64] hover:bg-white/90",
                                    ].join(" ")}
                                    title="Drag onto wall (or click then click wall)"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    + {k.toUpperCase()}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ✅ DROPDOWN PANEL (absolute) */}
                {showList && (
                    <div
                        className="absolute left-3 top-[48px] z-50"
                        onMouseDown={(e) => e.stopPropagation()} // ✅ กัน click ใน panel ทำให้ปิด
                    >
                        <div className="rounded-lg bg-[#0b3a64] border border-white/20 p-2 w-[360px] shadow-lg">
                            {layouts.length === 0 ? (
                                <div className="text-xs text-white/70">No saved layouts</div>
                            ) : (
                                <div className="space-y-1 max-h-[240px] overflow-auto">
                                    {layouts.map((l: any) => (
                                        <div key={l.id} className="flex items-center gap-2">
                                            <button
                                                className="px-2 py-1 rounded bg-white text-[#0b3a64] text-xs font-semibold hover:bg-white/90"
                                                onClick={() => {
                                                    loadLayout(l.id)
                                                    setShowList(false)
                                                }}
                                            >
                                                Load
                                            </button>

                                            <div className="text-xs text-white flex-1 truncate">{l.name}</div>

                                            <button
                                                className="px-2 py-1 rounded bg-red-500 text-white text-xs font-semibold hover:bg-red-600"
                                                onClick={() => deleteLayout(l.id)}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* CANVAS WRAPPER (DROP TARGET) */}
            <div
                ref={wrapRef}
                className="flex-1 overflow-auto bg-white"
                onDrop={handleDrop}
                onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "copy"
                }}
            >
                <Stage
                    ref={stageRef as any}
                    width={stageW}
                    height={stageH}
                    onMouseDown={onStageMouseDown}
                    onMouseMove={onStageMouseMove}
                    onMouseUp={onStageMouseUp}
                >
                    {/* LAYER 1: BG + GRID + EQUIP */}
                    <Layer>
                        {/* Background hit area */}
                        <Rect name="bg" x={0} y={0} width={stageW} height={stageH} fill="white" />

                        {/* Border */}
                        <Rect
                            x={0}
                            y={0}
                            width={stageW}
                            height={stageH}
                            stroke="#0b3a64"
                            strokeWidth={2}
                            listening={false}
                        />

                        {/* Grid */}
                        <Group listening={false}>{gridLines}</Group>

                        {/*EQUIPMENTS*/}
                        {orderedPlaced.map((p: PlacedItem) => {
                            const def = equipments.find((x) => x.id === p.equipmentId)
                            if (!def) return null

                            const rot = normRot(p.rotationDeg)
                            const fp = footprintCm(def, rot)

                            const wPx = cmToPx(fp.wCm)
                            const dPx = cmToPx(fp.dCm)

                            const labelPad = u(LABEL_PAD)
                            const titleFs = u(TITLE_FS)
                            const bodyFs = u(BODY_FS)
                            const labelRadius = u(LABEL_RADIUS)

                            const arrowLen = u(ARROW_LEN)
                            const arrowHead = u(ARROW_HEAD)
                            const arrowStroke = u(ARROW_STROKE)
                            const arrowGap = u(ARROW_GAP)

                            const title = def.name
                            const titleW = estimateTextWidthPx(title, titleFs)

                            // --- label size (adaptive) ---
                            const desiredH = u(70)
                            const minInsideH = u(44)

                            // พื้นที่สูงที่ "พอจะวาง label ในตัวเครื่องได้"
                            const insideAvailH = dPx - labelPad * 2
                            const canPlaceInside = insideAvailH >= minInsideH

                            // ถ้าวางในตัวได้: บีบความสูงไม่ให้เกิน insideAvailH
                            // ถ้าวางในตัวไม่ได้: ใช้ความสูงตามปกติ แล้ว "ย้ายขึ้นไปด้านบน"
                            const labelH = canPlaceInside ? Math.min(desiredH, insideAvailH) : desiredH

                            // --- label width (ไม่ให้ล้นซ้าย/ขวา) ---
                            const labelMaxW = Math.max(0, wPx - labelPad * 2)
                            const desiredMinW = u(120)
                            const labelMinW = Math.min(desiredMinW, labelMaxW)
                            const desiredW = labelPad + titleW + arrowGap + arrowLen + labelPad
                            const labelW = clamp(desiredW, labelMinW, labelMaxW)

                            // --- label position ---
                            const labelX = labelPad
                            const labelY = canPlaceInside
                                ? clamp(labelPad, labelPad, Math.max(labelPad, dPx - labelH - labelPad))
                                : -(labelH + u(6)) // ✅ ของเตี้ยมาก -> วาง label ไว้ "ด้านบนชิ้นงาน"

                            const arrow = buildArrowBelowLabel({
                                labelX,
                                labelY,
                                labelW,
                                labelH,
                                rotDeg: rot,
                                footH: dPx,
                                arrowLen,
                                arrowHead,
                            })

                            return (
                                <Group
                                    key={p.instanceId}
                                    x={cmToPx(p.xCm)}
                                    y={cmToPx(p.yCm)}
                                    draggable={selectedId === p.instanceId}
                                    onMouseEnter={(e) => {
                                        const stage = e.target.getStage()
                                        if (!stage) return
                                        stage.container().style.cursor = selectedId === p.instanceId ? "move" : "pointer"
                                    }}
                                    onMouseLeave={(e) => {
                                        const stage = e.target.getStage()
                                        if (!stage) return
                                        stage.container().style.cursor = "default"
                                    }}
                                    onClick={() => {
                                        selectWall(null)
                                        select(p.instanceId)
                                        setTool("select")
                                    }}
                                    onTap={() => {
                                        selectWall(null)
                                        select(p.instanceId)
                                        setTool("select")
                                    }}
                                    dragBoundFunc={(pos) => {
                                        let nx = pxToCm(pos.x)
                                        let ny = pxToCm(pos.y)

                                        const isL2 = (p.stackLevel ?? 0) === 1

                                        if (!isL2) {
                                            const s1 = edgeSnapNearCm({
                                                xCm: nx,
                                                yCm: ny,
                                                moving: fp,
                                                movingRotDeg: rot,
                                                placed,
                                                equipments,
                                                selfId: p.instanceId,
                                                areaW: area.wCm,
                                                areaD: area.dCm,
                                                snapRadiusCm: SNAP_RADIUS_CM,
                                                frontSnapRadiusCm: 2.0,
                                                cornerSnapRadiusCm: 1.8,
                                                overlapMinCm: 0.2,
                                                overlapSlackCm: 0.8,
                                            })

                                            nx = s1.xCm
                                            ny = s1.yCm

                                            if (!(s1.snappedX || s1.snappedY)) {
                                                nx = snapStep(nx, SNAP_STEP_CM)
                                                ny = snapStep(ny, SNAP_STEP_CM)
                                            }

                                            const locked = resolveNoOverlapCm({
                                                xCm: nx,
                                                yCm: ny,
                                                moving: fp,
                                                movingStackLevel: 0,
                                                placed,
                                                equipments,
                                                selfId: p.instanceId,
                                                areaW: area.wCm,
                                                areaD: area.dCm,
                                            })
                                            nx = locked.xCm
                                            ny = locked.yCm

                                            // clamp
                                            const maxX = area.wCm - fp.wCm
                                            const maxY = area.dCm - fp.dCm
                                            nx = clamp(nx, 0, maxX)
                                            ny = clamp(ny, 0, maxY)
                                        } else {
                                            const ss = stackSnapToNearestL1Cm({
                                                xCm: nx,
                                                yCm: ny,
                                                placed,
                                                selfId: p.instanceId,
                                                radiusCm: STACK_SNAP_RADIUS_CM,
                                            })

                                            if (ss.snapped) {
                                                nx = ss.xCm
                                                ny = ss.yCm
                                            } else {
                                                nx = snapStep(nx, SNAP_STEP_CM)
                                                ny = snapStep(ny, SNAP_STEP_CM)
                                            }

                                            const maxX = area.wCm - fp.wCm
                                            const maxY = area.dCm - fp.dCm
                                            nx = clamp(nx, 0, maxX)
                                            ny = clamp(ny, 0, maxY)
                                        }

                                        return { x: cmToPx(nx), y: cmToPx(ny) }
                                    }}
                                    onDragEnd={(ev) => {
                                        let nx = pxToCm(ev.target.x())
                                        let ny = pxToCm(ev.target.y())

                                        const isL2 = (p.stackLevel ?? 0) === 1

                                        if (!isL2) {
                                            const s1 = edgeSnapNearCm({
                                                xCm: nx,
                                                yCm: ny,
                                                moving: fp,
                                                movingRotDeg: rot,
                                                placed,
                                                equipments,
                                                selfId: p.instanceId,
                                                areaW: area.wCm,
                                                areaD: area.dCm,
                                                snapRadiusCm: SNAP_RADIUS_CM,
                                                frontSnapRadiusCm: 2.0,
                                                cornerSnapRadiusCm: 1.8,
                                                overlapMinCm: 0.2,
                                                overlapSlackCm: 0.8,
                                            })

                                            nx = s1.xCm
                                            ny = s1.yCm

                                            if (!(s1.snappedX || s1.snappedY)) {
                                                nx = snapStep(nx, SNAP_STEP_CM)
                                                ny = snapStep(ny, SNAP_STEP_CM)
                                            }

                                            const locked = resolveNoOverlapCm({
                                                xCm: nx,
                                                yCm: ny,
                                                moving: fp,
                                                movingStackLevel: 0,
                                                placed,
                                                equipments,
                                                selfId: p.instanceId,
                                                areaW: area.wCm,
                                                areaD: area.dCm,
                                            })
                                            nx = locked.xCm
                                            ny = locked.yCm

                                            const maxX = area.wCm - fp.wCm
                                            const maxY = area.dCm - fp.dCm
                                            nx = clamp(nx, 0, maxX)
                                            ny = clamp(ny, 0, maxY)

                                            movePlaced(p.instanceId, nx, ny)
                                        } else {
                                            const ss = stackSnapToNearestL1Cm({
                                                xCm: nx,
                                                yCm: ny,
                                                placed,
                                                selfId: p.instanceId,
                                                radiusCm: STACK_SNAP_RADIUS_CM,
                                            })

                                            if (ss.snapped && ss.baseId) {
                                                nx = ss.xCm
                                                ny = ss.yCm
                                                movePlaced(p.instanceId, nx, ny, { stackBaseId: ss.baseId })
                                                return
                                            }

                                            movePlaced(p.instanceId, nx, ny, { stackLevel: 0, stackBaseId: null })
                                        }
                                    }}
                                >
                                    {/* footprint */}
                                    <Rect
                                        width={wPx}
                                        height={dPx}
                                        fill={selectedId === p.instanceId ? "#ffe8a3" : "#d1d5db"}
                                        stroke="#111827"
                                        strokeWidth={u(1)}
                                        cornerRadius={u(4)}
                                    />

                                    {/* label */}
                                    <Group>
                                        <Rect
                                            x={labelX}
                                            y={labelY}
                                            width={labelW}
                                            height={labelH}
                                            fill={LABEL_BG}
                                            stroke={LABEL_STROKE}
                                            strokeWidth={u(0.5)}
                                            cornerRadius={labelRadius}
                                        />

                                        <Text
                                            text={title}
                                            fontSize={titleFs}
                                            fontStyle="bold"
                                            fill="#111827"
                                            x={labelX + labelPad}
                                            y={labelY + u(6)}
                                        />

                                        <Text
                                            text={`${def.wCm}x${def.dCm}cm\nL:${(p.stackLevel ?? 0) + 1}\nrot:${rot}`}
                                            fontSize={bodyFs}
                                            fill="#111827"
                                            x={labelX + labelPad}
                                            y={labelY + u(28)}
                                        />

                                        <Line points={arrow.shaft} stroke="#111827" strokeWidth={arrowStroke} lineCap="round" />
                                        <Line points={arrow.head} stroke="#111827" strokeWidth={arrowStroke} lineCap="round" lineJoin="round" />
                                    </Group>
                                </Group>
                            )
                        })}
                    </Layer>

                    {/* LAYER 2: WALLS (TOP)*/}
                    <Layer>
                        {/* WALLS (real) */}
                        {walls.map((w) => {
                            const selected = w.id === selectedWallId
                            const x1 = cmToPx(w.x1Cm)
                            const y1 = cmToPx(w.y1Cm)
                            const x2 = cmToPx(w.x2Cm)
                            const y2 = cmToPx(w.y2Cm)

                            const dxPx = x2 - x1
                            const dyPx = y2 - y1

                            // snap helper
                            const snapPx = (vPx: number) => cmToPx(snapStep(pxToCm(vPx), SNAP_STEP_CM))

                            return (
                                <Group
                                    key={w.id}
                                    x={x1}
                                    y={y1}
                                    draggable={selected} // ✅ เลือกแล้วลากทั้งเส้นได้
                                    dragBoundFunc={(pos) => {
                                        // pos คือ x,y ของ group (ตำแหน่งจุดเริ่มต้น)
                                        return { x: snapPx(pos.x), y: snapPx(pos.y) }
                                    }}
                                    onMouseDown={(ev) => {
                                        ev.cancelBubble = true

                                        // ✅ ถ้าอยู่ในโหมดวางโปสเตอร์ -> วางเลย ไม่ต้อง select wall
                                        if (posterTool) {
                                            const stage = ev.target.getStage?.()
                                            const p = stage?.getPointerPosition?.()
                                            if (!p) return

                                            // ✅ เอา pointer เป็น local ของ wall-group (px)
                                            const localPx = {
                                                x: p.x - x1,
                                                y: p.y - y1,
                                            }

                                            // ✅ local px -> local cm
                                            const localCm = {
                                                x: pxToCm(localPx.x),
                                                y: pxToCm(localPx.y),
                                            }

                                            // wall vector ใน "cm local" = (dxCm, dyCm)
                                            const dxCm = w.x2Cm - w.x1Cm
                                            const dyCm = w.y2Cm - w.y1Cm

                                            // จุดคลิก local เทียบกับจุดเริ่ม wall (local start = 0,0)
                                            const wx = localCm.x
                                            const wy = localCm.y

                                            const vv = dxCm * dxCm + dyCm * dyCm
                                            const t = vv <= 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * dxCm + wy * dyCm) / vv))

                                            addPosterOnWall(w.id, t, posterTool)
                                            return
                                        }

                                        // ✅ โหมดปกติ: select wall
                                        select(null)
                                        selectWall(w.id)
                                        setTool("select")
                                    }}
                                    onDragMove={(ev) => {
                                        // ✅ ลากทั้งเส้น: อัปเดต x1/y1/x2/y2 พร้อมกัน
                                        const gx = ev.target.x()
                                        const gy = ev.target.y()

                                        const nx1 = snapStep(pxToCm(gx), SNAP_STEP_CM)
                                        const ny1 = snapStep(pxToCm(gy), SNAP_STEP_CM)

                                        const nx2 = snapStep(pxToCm(gx + dxPx), SNAP_STEP_CM)
                                        const ny2 = snapStep(pxToCm(gy + dyPx), SNAP_STEP_CM)

                                        updateWall(w.id, { x1Cm: nx1, y1Cm: ny1, x2Cm: nx2, y2Cm: ny2 })
                                    }}
                                    onDragEnd={() => {
                                        // กันค้าง cursor / state (ถ้าคุณใช้ dragWall ที่อื่นอยู่)
                                        setDragWall(null)
                                    }}
                                >
                                    {/* hit line (อยู่ที่ local 0,0 -> dx,dy) */}
                                    <Line
                                        points={[0, 0, dxPx, dyPx]}
                                        stroke="rgba(0,0,0,0)"
                                        strokeWidth={WALL_HIT_STROKE_PX}
                                        lineCap="round"
                                    />

                                    {/* visible wall */}
                                    <Line
                                        points={[0, 0, dxPx, dyPx]}
                                        stroke={selected ? "#2563eb" : "#111827"}
                                        opacity={selected ? 0.65 : 0.25}
                                        strokeWidth={Math.max(2, cmToPx(w.thicknessCm))}
                                        lineCap="square"
                                        listening={false}
                                    />

                                    {/* handles (ลากปลายเหมือนเดิม แต่ต้องใช้ local coords) */}
                                    {selected && (
                                        <>
                                            <Circle
                                                x={0}
                                                y={0}
                                                radius={WALL_HANDLE_R_PX}
                                                fill="#ffffff"
                                                stroke="#2563eb"
                                                strokeWidth={2}
                                                draggable
                                                onMouseDown={(ev) => (ev.cancelBubble = true)}
                                                onDragMove={(ev) => {
                                                    ev.cancelBubble = true
                                                    // handle drag: แปลงตำแหน่ง local-> world
                                                    const gx = (ev.target.getParent() as any).x()
                                                    const gy = (ev.target.getParent() as any).y()
                                                    const hx = gx + ev.target.x()
                                                    const hy = gy + ev.target.y()

                                                    let xCm = snapStep(pxToCm(hx), SNAP_STEP_CM)
                                                    let yCm = snapStep(pxToCm(hy), SNAP_STEP_CM)

                                                    // shift lock axis
                                                    if (ev.evt?.shiftKey) {
                                                        const dx = Math.abs(xCm - w.x2Cm)
                                                        const dy = Math.abs(yCm - w.y2Cm)
                                                        if (dx > dy) yCm = w.y2Cm
                                                        else xCm = w.x2Cm
                                                    }

                                                    updateWall(w.id, { x1Cm: xCm, y1Cm: yCm })
                                                }}
                                            />

                                            <Circle
                                                x={dxPx}
                                                y={dyPx}
                                                radius={WALL_HANDLE_R_PX}
                                                fill="#ffffff"
                                                stroke="#2563eb"
                                                strokeWidth={2}
                                                draggable
                                                onMouseDown={(ev) => (ev.cancelBubble = true)}
                                                onDragMove={(ev) => {
                                                    ev.cancelBubble = true
                                                    const gx = (ev.target.getParent() as any).x()
                                                    const gy = (ev.target.getParent() as any).y()
                                                    const hx = gx + ev.target.x()
                                                    const hy = gy + ev.target.y()

                                                    let xCm = snapStep(pxToCm(hx), SNAP_STEP_CM)
                                                    let yCm = snapStep(pxToCm(hy), SNAP_STEP_CM)

                                                    if (ev.evt?.shiftKey) {
                                                        const dx = Math.abs(xCm - w.x1Cm)
                                                        const dy = Math.abs(yCm - w.y1Cm)
                                                        if (dx > dy) yCm = w.y1Cm
                                                        else xCm = w.x1Cm
                                                    }

                                                    updateWall(w.id, { x2Cm: xCm, y2Cm: yCm })
                                                }}
                                            />
                                        </>
                                    )}
                                </Group>
                            )
                        })}

                        {/* POSTERS (2D = flat rect + label) */}
                        {/* หลังจาก render walls เสร็จ */}
                        {posters.map((p: PosterItem) => {
                            const w = walls.find((x) => x.id === p.wallId)
                            if (!w) return null

                            // point on wall (cm)
                            const xCm = w.x1Cm + (w.x2Cm - w.x1Cm) * p.t
                            const yCm = w.y1Cm + (w.y2Cm - w.y1Cm) * p.t

                            // wall direction + angle
                            const vx = w.x2Cm - w.x1Cm
                            const vy = w.y2Cm - w.y1Cm
                            const len = Math.hypot(vx, vy) || 1
                            const angRad = Math.atan2(vy, vx)
                            const angDeg = (angRad * 180) / Math.PI

                            // normal (ดันเข้า/ออกจากเส้นกำแพงนิดหน่อย)
                            const nx = -vy / len
                            const ny = vx / len

                            // ✅ ให้โปสเตอร์ “ไม่หลุดออกจากเส้นกำแพง”:
                            const side = p.flip ? 1 : -1
                            const stickCm = 0.5 // ✅ ชิดผิวกำแพง (ปรับ 0..1)
                            const extra = p.offsetCm ?? 0
                            const offsetCm = side * (stickCm + extra)

                            const px = cmToPx(xCm + nx * offsetCm)
                            const py = cmToPx(yCm + ny * offsetCm)

                            // ✅ ใช้ขนาดจริงจาก POSTER_SPECS (cm -> px)
                            const spec = POSTER_SPECS[p.imageKey]
                            const wPx = cmToPx(spec.wCm)
                            const hPx = cmToPx(spec.hCm)

                            // ความหนาแถบใน top-view (ไม่ต้องเท่าความสูงจริง)
                            const bandPx = Math.max(14, u(16))  // ✅ หนาอ่านง่าย (ปรับได้)

                            // ✅ ให้แถบหนาใน top-view = ความหนาผนัง หรือกำหนดเอง
                            const thickPx = Math.max(8, cmToPx(2)) // 2cm เป็นความหนาให้เห็นชัด (ปรับได้)

                            const selected = selectedPosterId === p.id

                            return (
                                <Group
                                    key={p.id}
                                    x={px}
                                    y={py}
                                    rotation={angDeg}
                                    onMouseDown={(ev) => {
                                        ev.cancelBubble = true
                                        select(null)
                                        selectWall(null)
                                        selectPoster(p.id)
                                        setTool("select")
                                    }}

                                    onDblClick={(ev) => {
                                        ev.cancelBubble = true
                                        flipPoster(p.id)
                                    }}

                                    draggable={selected} // ✅ เลือกแล้วลากได้
                                    onDragMove={(ev) => {
                                        ev.cancelBubble = true

                                        // ตอนลาก: เอา position world->cm แล้ว "ฉายกลับลงบนเส้นกำแพง" เพื่ออัปเดต t
                                        const stage = ev.target.getStage()
                                        const pos = ev.target.absolutePosition()
                                        const xCm2 = pxToCm(pos.x)
                                        const yCm2 = pxToCm(pos.y)

                                        const wx = xCm2 - w.x1Cm
                                        const wy = yCm2 - w.y1Cm
                                        const vv = vx * vx + vy * vy
                                        const t = vv <= 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv))
                                        updatePosterT(p.id, t)

                                        // ✅ บังคับให้เกาะผิวกำแพงทันที
                                        const xCm3 = w.x1Cm + (w.x2Cm - w.x1Cm) * t
                                        const yCm3 = w.y1Cm + (w.y2Cm - w.y1Cm) * t
                                        const px3 = cmToPx(xCm3 + nx * offsetCm)
                                        const py3 = cmToPx(yCm3 + ny * offsetCm)
                                        ev.target.absolutePosition({ x: px3, y: py3 })
                                    }}
                                >
                                    {/* สี่เหลี่ยมเล็ก */}
                                    <Rect
                                        x={-wPx / 2}
                                        y={-bandPx / 2}
                                        width={wPx}
                                        height={bandPx}
                                        fill={selected ? "rgba(59,130,246,0.28)" : "rgba(255,255,255,0.75)"} // ✅ พื้นหลังสว่าง
                                        stroke="#111827"
                                        strokeWidth={1}
                                        cornerRadius={u(3)}
                                    />

                                    <Text
                                        text={p.imageKey.toUpperCase()}
                                        fontSize={10}
                                        fill="#111827"
                                        x={-wPx / 2 + 2}
                                        y={-thickPx / 2 + 2}
                                        listening={false}
                                    />
                                </Group>
                            )
                        })}

                        {/* WALL DRAFT (preview) (โปร่งใส) */}
                        {tool === "wall" && wallStart && wallEnd && (
                            <Line
                                listening={false}          // ✅ เพิ่มบรรทัดนี้
                                points={[
                                    cmToPx(wallStart.xCm),
                                    cmToPx(wallStart.yCm),
                                    cmToPx(wallEnd.xCm),
                                    cmToPx(wallEnd.yCm),
                                ]}
                                stroke="#2563eb"
                                opacity={0.35}
                                strokeWidth={cmToPx(WALL_DEFAULT_THICK_CM)}
                                dash={[8, 6]}
                                lineCap="square"
                            />
                        )}
                    </Layer>
                </Stage>
            </div>
        </div>
    )
}