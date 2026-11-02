import QtQuick

Canvas {
    id: icon
    property string name: "close"
    property color ink: "white"
    implicitWidth: 20
    implicitHeight: 20
    antialiasing: true
    onNameChanged: requestPaint()
    onInkChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onPaint: {
        const c = getContext("2d")
        c.clearRect(0, 0, width, height)
        c.save()
        c.scale(width / 24, height / 24)
        c.strokeStyle = ink
        c.fillStyle = ink
        c.lineWidth = 1.9
        c.lineCap = "round"
        c.lineJoin = "round"
        c.beginPath()
        if (name === "close") {
            c.moveTo(5, 5); c.lineTo(19, 19)
            c.moveTo(19, 5); c.lineTo(5, 19)
        } else if (name === "play" || name === "next" || name === "playBlocked") {
            c.moveTo(7, 4); c.lineTo(20, 12); c.lineTo(7, 20); c.closePath()
            if (name !== "playBlocked") c.fill()
            if (name === "next") { c.beginPath(); c.moveTo(21, 4); c.lineTo(21, 20) }
            if (name === "playBlocked") { c.moveTo(3, 3); c.lineTo(22, 22) }
        } else if (name === "pause") {
            c.roundedRect(6, 4, 4, 16, 0.8, 0.8)
            c.roundedRect(14, 4, 4, 16, 0.8, 0.8)
            c.fill()
        } else if (name === "previousChannel" || name === "nextChannel") {
            const direction = name === "previousChannel" ? -1 : 1
            c.moveTo(12 - direction * 3, 4)
            c.lineTo(12 + direction * 4, 12)
            c.lineTo(12 - direction * 3, 20)
        } else if (name === "heart" || name === "heartFilled") {
            c.moveTo(12, 21)
            c.bezierCurveTo(8, 17.5, 2, 13.2, 2, 8)
            c.bezierCurveTo(2, 2.3, 8.4, 1, 12, 6)
            c.bezierCurveTo(15.6, 1, 22, 2.3, 22, 8)
            c.bezierCurveTo(22, 13.2, 16, 17.5, 12, 21)
            c.closePath()
            if (name === "heartFilled") c.fill()
        } else if (name === "volume" || name === "muted") {
            c.moveTo(3, 9); c.lineTo(7, 9); c.lineTo(12, 5); c.lineTo(12, 19)
            c.lineTo(7, 15); c.lineTo(3, 15); c.closePath(); c.fill()
            c.beginPath()
            if (name === "volume") {
                c.moveTo(16, 8); c.bezierCurveTo(18.5, 10, 18.5, 14, 16, 16)
                c.moveTo(19, 5); c.bezierCurveTo(23, 8.5, 23, 15.5, 19, 19)
            } else {
                c.moveTo(16, 9); c.lineTo(22, 15)
                c.moveTo(22, 9); c.lineTo(16, 15)
            }
        } else if (name === "audio") {
            for (let i = 0; i < 7; ++i) {
                const heights = [7, 14, 20, 11, 18, 12, 6]
                c.moveTo(3 + i * 3, 12 - heights[i] / 2)
                c.lineTo(3 + i * 3, 12 + heights[i] / 2)
            }
        } else if (name === "subtitles") {
            c.moveTo(5, 3); c.lineTo(19, 3); c.quadraticCurveTo(22, 3, 22, 6)
            c.lineTo(22, 15); c.quadraticCurveTo(22, 18, 19, 18)
            c.lineTo(10, 18); c.lineTo(6, 22); c.lineTo(6, 18)
            c.lineTo(5, 18); c.quadraticCurveTo(2, 18, 2, 15)
            c.lineTo(2, 6); c.quadraticCurveTo(2, 3, 5, 3)
            c.moveTo(6, 8); c.lineTo(10, 8); c.moveTo(13, 8); c.lineTo(18, 8)
            c.moveTo(6, 12); c.lineTo(13, 12); c.moveTo(16, 12); c.lineTo(18, 12)
        } else if (name === "episodes") {
            c.roundedRect(2, 8, 20, 14, 2, 2)
            c.moveTo(4, 5); c.lineTo(20, 5)
            c.moveTo(7, 2); c.lineTo(17, 2)
        } else if (name === "guide") {
            c.roundedRect(2, 5, 20, 17, 2, 2)
            c.moveTo(2, 10); c.lineTo(22, 10)
            c.moveTo(7, 2); c.lineTo(7, 7); c.moveTo(17, 2); c.lineTo(17, 7)
            for (let x = 6; x <= 18; x += 6) {
                for (let y = 14; y <= 18; y += 4) c.rect(x - 0.5, y - 0.5, 1, 1)
            }
        } else if (name === "settings") {
            c.moveTo(2, 5); c.lineTo(6, 5); c.moveTo(10, 5); c.lineTo(22, 5)
            c.moveTo(2, 12); c.lineTo(14, 12); c.moveTo(18, 12); c.lineTo(22, 12)
            c.moveTo(2, 19); c.lineTo(6, 19); c.moveTo(10, 19); c.lineTo(22, 19)
            c.roundedRect(6, 2, 4, 6, 1, 1)
            c.roundedRect(14, 9, 4, 6, 1, 1)
            c.roundedRect(6, 16, 4, 6, 1, 1)
        } else if (name === "fullscreen" || name === "exitFullscreen") {
            if (name === "fullscreen") {
                c.moveTo(3, 9); c.lineTo(3, 3); c.lineTo(9, 3)
                c.moveTo(3, 3); c.lineTo(10, 10)
                c.moveTo(15, 21); c.lineTo(21, 21); c.lineTo(21, 15)
                c.moveTo(14, 14); c.lineTo(21, 21)
            } else {
                c.moveTo(3, 3); c.lineTo(10, 10); c.moveTo(4, 10); c.lineTo(10, 10); c.lineTo(10, 4)
                c.moveTo(21, 21); c.lineTo(14, 14); c.moveTo(14, 20); c.lineTo(14, 14); c.lineTo(20, 14)
            }
        } else if (name === "check") {
            c.moveTo(4, 12); c.lineTo(9, 17); c.lineTo(20, 6)
        }
        c.stroke()
        c.restore()
    }
}
