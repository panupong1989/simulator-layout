import type { Equipment } from "@/lib/types"

export function canStack(top: Equipment, bottom: Equipment) {
    // ปรับตามจริงได้
    const ok = (id: string) => ["WASH", "DRY"].includes(id)

    if (!ok(top.id) || !ok(bottom.id)) return false

    // อนุญาตทุกคู่ระหว่าง washer/dryer (2 ชั้น)
    return true
}
