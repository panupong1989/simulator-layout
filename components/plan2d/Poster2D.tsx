"use client"
import React from "react"
import { Group, Image as KImage, Rect } from "react-konva"
import useImage from "use-image"

const POSTER_SRC: Record<string, string> = {
    rule: "/posters/rule.png",
    price: "/posters/price.png",
    howto: "/posters/howto.png",
}

export function Poster2D(props: {
    x: number
    y: number
    wPx: number
    hPx: number
    keyName: string
}) {
    const src = POSTER_SRC[props.keyName] ?? POSTER_SRC["rule"]
    const [img] = useImage(src)

    return (
        <Group x={props.x} y={props.y}>
            {/* fallback bg เผื่อรูปยังโหลดไม่ทัน */}
            <Rect x={-props.wPx / 2} y={-props.hPx / 2} width={props.wPx} height={props.hPx} fill="#fff3" stroke="#111827" strokeWidth={1} />
            {img && (
                <KImage
                    image={img}
                    x={-props.wPx / 2}
                    y={-props.hPx / 2}
                    width={props.wPx}
                    height={props.hPx}
                />
            )}
        </Group>
    )
}