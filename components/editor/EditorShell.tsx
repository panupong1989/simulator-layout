"use client"

import { useState } from "react"
import Plan2DStage from "@/components/plan2d/Plan2DStage"
import View3DCanvas from "@/components/view3d/View3DCanvas"

type TabKey = "2d" | "3d"

export default function EditorShell() {
    const [tab, setTab] = useState<TabKey>("2d")

    return (
        <div className="h-screen flex flex-col">
            {/* Top bar */}
            <div className="h-12 border-b flex items-center gap-2 px-3 bg-black">
                <button
                    className={[
                        "px-3 py-1 rounded-md text-sm font-semibold transition",
                        tab === "2d"
                            ? "bg-blue-600 text-white shadow"
                            : "bg-white text-gray-900 border border-gray-300 hover:bg-gray-100",
                    ].join(" ")}
                    onClick={() => setTab("2d")}
                >
                    2D
                </button>

                <button
                    className={[
                        "px-3 py-1 rounded-md text-sm font-semibold transition",
                        tab === "3d"
                            ? "bg-blue-600 text-white shadow"
                            : "bg-white text-gray-900 border border-gray-300 hover:bg-gray-100",
                    ].join(" ")}
                    onClick={() => setTab("3d")}
                >
                    3D
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {tab === "2d" ? <Plan2DStage /> : <View3DCanvas />}
            </div>
        </div>
    )
}
