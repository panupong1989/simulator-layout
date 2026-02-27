import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Area, Equipment, PlacedItem } from "@/lib/types"
import { EQUIPMENTS } from "@/lib/equipmentCatalog"

export type LayoutSnapshot = {
    id: string
    name: string
    area: Area
    walls: WallItem[]
    placed: PlacedItem[]
    savedAt: number
}

// ======================
// WALL TYPES
// ======================
export type ToolMode = "select" | "wall"

export type WallItem = {
    id: string
    x1Cm: number
    y1Cm: number
    x2Cm: number
    y2Cm: number
    thicknessCm: number
}


// ======================
// STATE
// ======================
type State = {
    // --- 기존 ---
    area: Area
    equipments: Equipment[]
    placed: PlacedItem[]
    selectedId: string | null

    setArea: (patch: Partial<Area>) => void
    addPlaced: (equipmentId: string, xCm: number, yCm: number) => void
    movePlaced: (instanceId: string, xCm: number, yCm: number, patch?: Partial<PlacedItem>) => void
    rotatePlaced: (instanceId: string) => void
    removePlaced: (instanceId: string) => void
    select: (id: string | null) => void
    toggleStack: (instanceId: string) => void

    // --- WALL ---
    tool: ToolMode
    setTool: (t: ToolMode) => void

    walls: WallItem[]
    selectedWallId: string | null
    selectWall: (id: string | null) => void
    addWall: (w: WallItem) => void
    updateWall: (id: string, patch: Partial<WallItem>) => void
    removeWall: (id: string) => void

    // --- SAVED LAYOUTS ---
    layouts: LayoutSnapshot[]
    saveLayout: (name: string) => void
    loadLayout: (id: string) => void
    deleteLayout: (id: string) => void
    renameLayout: (id: string, name: string) => void
}

// ======================
// HELPERS (ของเดิม)
// ======================
function rectOverlapArea(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
) {
    const x1 = Math.max(a.x, b.x)
    const y1 = Math.max(a.y, b.y)
    const x2 = Math.min(a.x + a.w, b.x + b.w)
    const y2 = Math.min(a.y + a.h, b.y + b.h)
    const w = x2 - x1
    const h = y2 - y1
    return w > 0 && h > 0 ? w * h : 0
}

function normRot(rotDeg?: number) {
    return (((rotDeg ?? 0) % 360) + 360) % 360
}

function footprintCm(def: Equipment, rotDeg?: number) {
    const r = normRot(rotDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}

// ✅ base = L1 ที่ overlap กับ “ตำแหน่งปัจจุบันของตัวที่จะเป็น L2” มากสุด
function findBestBaseFor(me: PlacedItem, placed: PlacedItem[], equipments: Equipment[]) {
    const meDef = equipments.find((e) => e.id === me.equipmentId)
    if (!meDef) return null

    const meFp = footprintCm(meDef, me.rotationDeg)
    const a = { x: me.xCm, y: me.yCm, w: meFp.wCm, h: meFp.dCm }

    let best: { id: string; area: number } | null = null

    for (const q of placed) {
        if (q.instanceId === me.instanceId) continue
        if ((q.stackLevel ?? 0) !== 0) continue // base ต้องเป็น L1

        const qDef = equipments.find((e) => e.id === q.equipmentId)
        if (!qDef) continue

        const qFp = footprintCm(qDef, q.rotationDeg)
        const b = { x: q.xCm, y: q.yCm, w: qFp.wCm, h: qFp.dCm }

        const area = rectOverlapArea(a, b)
        if (!best || area > best.area) best = { id: q.instanceId, area }
    }

    if (!best) return null

    // ✅ threshold แนะนำ: อย่างน้อย 20% ของพื้นที่ตัวที่จะซ้อน
    const movingArea = a.w * a.h
    if (best.area < movingArea * 0.2) return null

    return best.id
}

// ======================
// STORE
// ======================
export const useProjectStore = create<State>()(
    persist(
        (set, get) => ({
            // ---- existing ----
            area: { wCm: 500, dCm: 300, gridCm: 10 },
            equipments: EQUIPMENTS as unknown as Equipment[],
            placed: [],
            selectedId: null,

            setArea: (patch) => set({ area: { ...get().area, ...patch } }),

            addPlaced: (equipmentId, xCm, yCm) =>
                set((s) => ({
                    placed: s.placed.concat({
                        instanceId: crypto.randomUUID(),
                        equipmentId,
                        xCm,
                        yCm,
                        rotationDeg: 0,
                        stackLevel: 0,
                        // stackBaseId: null, // ถ้า type PlacedItem มี field นี้อยู่แล้ว ปลดคอมเมนต์ได้
                    }),
                })),

            movePlaced: (instanceId, xCm, yCm, patch) =>
                set((s) => ({
                    placed: s.placed.map((p) => (p.instanceId === instanceId ? { ...p, xCm, yCm, ...(patch ?? {}) } : p)),
                })),

            rotatePlaced: (instanceId) =>
                set((s) => ({
                    placed: s.placed.map((p) => {
                        if (p.instanceId !== instanceId) return p
                        const next = ((p.rotationDeg + 90) % 360) as 0 | 90 | 180 | 270
                        return { ...p, rotationDeg: next }
                    }),
                })),

            toggleStack: (instanceId) =>
                set((s) => {
                    const me = s.placed.find((p) => p.instanceId === instanceId)
                    if (!me) return s

                    // L1 -> L2
                    if ((me.stackLevel ?? 0) === 0) {
                        const baseId = findBestBaseFor(me, s.placed, s.equipments)
                        const base = baseId ? s.placed.find((p) => p.instanceId === baseId) : null

                        return {
                            ...s,
                            placed: s.placed.map((p) =>
                                p.instanceId === instanceId
                                    ? {
                                        ...p,
                                        stackLevel: 1,
                                        stackBaseId: baseId ?? null,
                                        xCm: base ? base.xCm : p.xCm,
                                        yCm: base ? base.yCm : p.yCm,
                                    }
                                    : p
                            ),
                        }
                    }

                    // L2 -> L1
                    return {
                        ...s,
                        placed: s.placed.map((p) => (p.instanceId === instanceId ? { ...p, stackLevel: 0, stackBaseId: null } : p)),
                    }
                }),

            removePlaced: (instanceId) => set((s) => ({ placed: s.placed.filter((p) => p.instanceId !== instanceId) })),

            select: (id) => set({ selectedId: id }),

            // ---- WALL ----
            tool: "select",
            setTool: (t) => set({ tool: t }),

            walls: [],
            selectedWallId: null,

            selectWall: (id) => set({ selectedWallId: id }),

            addWall: (w) =>
                set((s) => ({
                    walls: [...s.walls, w],
                })),

            updateWall: (id, patch) =>
                set((s) => ({
                    walls: s.walls.map((x) => (x.id === id ? { ...x, ...patch } : x)),
                })),

            removeWall: (id) =>
                set((s) => ({
                    walls: s.walls.filter((x) => x.id !== id),
                    selectedWallId: s.selectedWallId === id ? null : s.selectedWallId,
                })),

            // ---- SAVED LAYOUTS ----
            layouts: [],

            saveLayout: (name) =>
                set((s) => {
                    const n = (name ?? "").trim()
                    if (!n) return s

                    const snap: LayoutSnapshot = {
                        id: crypto.randomUUID(),
                        name: n,
                        savedAt: Date.now(),   // ✅ ใช้ชื่อ field ให้ตรง type
                        area: { ...s.area },
                        walls: s.walls.map(w => ({ ...w })),
                        placed: s.placed.map(p => ({ ...p })),
                    }

                    return { ...s, layouts: [snap, ...s.layouts] }
                }),

            loadLayout: (id) =>
                set((s) => {
                    const x = s.layouts.find((k) => k.id === id)
                    if (!x) return s
                    return {
                        ...s,
                        area: { ...x.area },
                        walls: x.walls.map(w => ({ ...w })),
                        placed: x.placed.map(p => ({ ...p })),
                        selectedId: null,
                        selectedWallId: null,
                        tool: "select",
                    }
                }),

            deleteLayout: (id) =>
                set((s) => ({ ...s, layouts: s.layouts.filter((k) => k.id !== id) })),

            renameLayout: (id, name) =>
                set((s) => ({
                    ...s,
                    layouts: s.layouts.map((k) => (k.id === id ? { ...k, name: name.trim() } : k)),
                })),

        }),
        {
            name: "simulator-layout-v2",
            partialize: (s) => ({
                area: s.area,
                placed: s.placed,
                walls: s.walls,
                layouts: s.layouts, // ✅ เพิ่ม
            }),
        }

    )
)