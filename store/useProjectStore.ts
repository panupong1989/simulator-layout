import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Area, Equipment, PlacedItem } from "@/lib/types"
import { EQUIPMENTS } from "@/lib/equipmentCatalog"
import { supabase } from "@/lib/supabaseClient"

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
// DB ROW TYPE
// ======================
export type LayoutRow = {
    id: string
    name: string
    area: Area
    walls: WallItem[]
    placed: PlacedItem[]
    created_at: string
    updated_at: string
}

// ======================
// STATE
// ======================
type State = {
    // core
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

    // wall
    tool: ToolMode
    setTool: (t: ToolMode) => void
    walls: WallItem[]
    selectedWallId: string | null
    selectWall: (id: string | null) => void
    addWall: (w: WallItem) => void
    updateWall: (id: string, patch: Partial<WallItem>) => void
    removeWall: (id: string) => void

    // layouts (จาก DB / local)
    layouts: LayoutRow[]
    isSyncingLayouts: boolean
    lastSyncError: string | null

    // Supabase CRUD
    syncLayouts: () => Promise<void>
    saveLayout: (name: string) => Promise<void>
    loadLayout: (id: string) => void
    deleteLayout: (id: string) => Promise<void>
    renameLayout: (id: string, name: string) => Promise<void>

    // optional: local-only utils
    upsertLayoutLocal: (row: LayoutRow) => void
    removeLayoutLocal: (id: string) => void
}

// ======================
// helpers
// ======================
function normRot(rotDeg?: number) {
    return (((rotDeg ?? 0) % 360) + 360) % 360
}

// ✅ base = L1 ที่ overlap กับ “ตำแหน่งปัจจุบันของตัวที่จะเป็น L2” มากสุด (ของคุณเดิม)
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

function footprintCm(def: Equipment, rotDeg?: number) {
    const r = normRot(rotDeg)
    const swap = r === 90 || r === 270
    return { wCm: swap ? def.dCm : def.wCm, dCm: swap ? def.wCm : def.dCm }
}

function findBestBaseFor(me: PlacedItem, placed: PlacedItem[], equipments: Equipment[]) {
    const meDef = equipments.find((e) => e.id === me.equipmentId)
    if (!meDef) return null

    const meFp = footprintCm(meDef, me.rotationDeg)
    const a = { x: me.xCm, y: me.yCm, w: meFp.wCm, h: meFp.dCm }

    let best: { id: string; area: number } | null = null

    for (const q of placed) {
        if (q.instanceId === me.instanceId) continue
        if ((q.stackLevel ?? 0) !== 0) continue

        const qDef = equipments.find((e) => e.id === q.equipmentId)
        if (!qDef) continue

        const qFp = footprintCm(qDef, q.rotationDeg)
        const b = { x: q.xCm, y: q.yCm, w: qFp.wCm, h: qFp.dCm }

        const area = rectOverlapArea(a, b)
        if (!best || area > best.area) best = { id: q.instanceId, area }
    }

    if (!best) return null
    const movingArea = a.w * a.h
    if (best.area < movingArea * 0.2) return null
    return best.id
}

// สร้าง row แบบ client-side ก่อน (created_at/updated_at จะได้ค่าจาก DB ตอน insert แต่เราทำไว้ให้ UI ลื่น)
function makeLocalRow(args: { id: string; name: string; area: Area; walls: WallItem[]; placed: PlacedItem[] }): LayoutRow {
    const nowIso = new Date().toISOString()
    return { ...args, created_at: nowIso, updated_at: nowIso }
}

// ======================
// STORE
// ======================
export const useProjectStore = create<State>()(
    persist(
        (set, get) => ({
            // core
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
                        stackBaseId: null,
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

                    if ((me.stackLevel ?? 0) === 0) {
                        const baseId = findBestBaseFor(me, s.placed, s.equipments)
                        const base = baseId ? s.placed.find((p) => p.instanceId === baseId) : null

                        return {
                            ...s,
                            placed: s.placed.map((p) =>
                                p.instanceId === instanceId
                                    ? ({
                                        ...p,
                                        stackLevel: 1,
                                        stackBaseId: baseId ?? null,
                                        xCm: base ? base.xCm : p.xCm,
                                        yCm: base ? base.yCm : p.yCm,
                                    } as any)
                                    : p
                            ),
                        }
                    }

                    return {
                        ...s,
                        placed: s.placed.map((p) =>
                            p.instanceId === instanceId
                                ? ({
                                    ...p,
                                    stackLevel: 0,
                                    stackBaseId: null,
                                } as any)
                                : p
                        ),
                    }
                }),

            removePlaced: (instanceId) => set((s) => ({ placed: s.placed.filter((p) => p.instanceId !== instanceId) })),
            select: (id) => set({ selectedId: id }),

            // wall
            tool: "select",
            setTool: (t) => set({ tool: t }),

            walls: [],
            selectedWallId: null,
            selectWall: (id) => set({ selectedWallId: id }),

            addWall: (w) => set((s) => ({ walls: [...s.walls, w] })),
            updateWall: (id, patch) => set((s) => ({ walls: s.walls.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
            removeWall: (id) =>
                set((s) => ({
                    walls: s.walls.filter((x) => x.id !== id),
                    selectedWallId: s.selectedWallId === id ? null : s.selectedWallId,
                })),

            // layouts
            layouts: [],
            isSyncingLayouts: false,
            lastSyncError: null,

            upsertLayoutLocal: (row) =>
                set((s) => {
                    const idx = s.layouts.findIndex((x) => x.id === row.id)
                    if (idx >= 0) {
                        const copy = s.layouts.slice()
                        copy[idx] = row
                        // sort ล่าสุดก่อน
                        copy.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
                        return { layouts: copy }
                    }
                    const next = [row, ...s.layouts]
                    next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
                    return { layouts: next }
                }),

            removeLayoutLocal: (id) => set((s) => ({ layouts: s.layouts.filter((x) => x.id !== id) })),

            // ---------- Supabase: list ----------
            syncLayouts: async () => {
                set({ isSyncingLayouts: true, lastSyncError: null })
                try {
                    const { data, error } = await supabase
                        .from("layouts")
                        .select("id,name,area,walls,placed,created_at,updated_at")
                        .order("updated_at", { ascending: false })

                    if (error) throw error
                    set({ layouts: (data ?? []) as LayoutRow[] })
                } catch (e: any) {
                    set({ lastSyncError: e?.message ?? String(e) })
                } finally {
                    set({ isSyncingLayouts: false })
                }
            },

            // ---------- Supabase: save ----------
            saveLayout: async (name) => {
                const n = (name ?? "").trim()
                if (!n) return

                const s = get()
                // ทำ row local ก่อน เพื่อให้ UI มีทันที
                const localId = crypto.randomUUID()
                const localRow = makeLocalRow({ id: localId, name: n, area: s.area, walls: s.walls, placed: s.placed })
                get().upsertLayoutLocal(localRow)

                try {
                    // insert จริงไป DB
                    const { data, error } = await supabase
                        .from("layouts")
                        .insert([
                            {
                                id: localId, // ใช้ id เดียวกัน (ง่ายสุด)
                                name: n,
                                area: s.area,
                                walls: s.walls,
                                placed: s.placed,
                            },
                        ])
                        .select("id,name,area,walls,placed,created_at,updated_at")
                        .single()

                    if (error) throw error
                    // replace ด้วยค่าจาก DB (created_at/updated_at จริง)
                    if (data) get().upsertLayoutLocal(data as LayoutRow)
                } catch (e: any) {
                    // ถ้า DB ไม่ได้ ให้แจ้งไว้ แต่ local ยังอยู่
                    set({ lastSyncError: e?.message ?? String(e) })
                }
            },

            // ---------- load ----------
            loadLayout: (id) =>
                set((s) => {
                    const x = s.layouts.find((k) => k.id === id)
                    if (!x) return s
                    return {
                        ...s,
                        area: x.area,
                        walls: x.walls,
                        placed: x.placed,
                        selectedId: null,
                        selectedWallId: null,
                        tool: "select",
                    }
                }),

            // ---------- delete ----------
            deleteLayout: async (id) => {
                // optimistic
                get().removeLayoutLocal(id)

                try {
                    const { error } = await supabase.from("layouts").delete().eq("id", id)
                    if (error) throw error
                } catch (e: any) {
                    set({ lastSyncError: e?.message ?? String(e) })
                    // ถ้าจะ “undo” ก็ทำได้ แต่ต้องมี snapshot เดิมไว้ (เวอร์ชันนี้ไม่ทำ undo)
                }
            },

            // ---------- rename ----------
            renameLayout: async (id, name) => {
                const n = (name ?? "").trim()
                if (!n) return

                // optimistic local
                const prev = get().layouts.find((x) => x.id === id)
                if (prev) get().upsertLayoutLocal({ ...prev, name: n, updated_at: new Date().toISOString() })

                try {
                    const { data, error } = await supabase
                        .from("layouts")
                        .update({ name: n })
                        .eq("id", id)
                        .select("id,name,area,walls,placed,created_at,updated_at")
                        .single()

                    if (error) throw error
                    if (data) get().upsertLayoutLocal(data as LayoutRow)
                } catch (e: any) {
                    set({ lastSyncError: e?.message ?? String(e) })
                }
            },
        }),
        {
            name: "simulator-layout-v3",
            // เก็บ local state ไว้ด้วย เผื่อ offline
            partialize: (s) => ({
                area: s.area,
                placed: s.placed,
                walls: s.walls,
                layouts: s.layouts,
            }),
        }
    )
)