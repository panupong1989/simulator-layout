function clamp01(x: number) { return Math.max(0, Math.min(1, x)) }

function pointToSegmentT(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const vx = x2 - x1, vy = y2 - y1
    const wx = px - x1, wy = py - y1
    const vv = vx * vx + vy * vy
    if (vv <= 1e-9) return 0
    const t = (wx * vx + wy * vy) / vv
    return clamp01(t)
}