"use client"

export default function Floor({ w, d }: { w: number; d: number }) {
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[w, d]} />
            <meshStandardMaterial />
        </mesh>
    )
}
