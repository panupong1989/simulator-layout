import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
    title: "Simulator Layout",
    description: "2D/3D layout simulator",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="th">
            <body>{children}</body>
        </html>
    )
}
