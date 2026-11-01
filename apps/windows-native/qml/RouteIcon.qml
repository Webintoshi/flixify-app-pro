import QtQuick

Canvas {
    id: icon
    property string route: "home"
    property color stroke: "#A7B0BE"
    implicitWidth: 24
    implicitHeight: 24
    onRouteChanged: requestPaint()
    onStrokeChanged: requestPaint()
    onPaint: {
        let c = getContext("2d");
        c.clearRect(0, 0, width, height);
        c.save();
        c.scale(width / 24, height / 24);
        c.strokeStyle = stroke;
        c.lineWidth = 1.6;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.beginPath();
        if (route === "home") {
            c.moveTo(3, 10);
            c.lineTo(12, 3);
            c.lineTo(21, 10);
            c.moveTo(5, 9);
            c.lineTo(5, 21);
            c.lineTo(10, 21);
            c.lineTo(10, 14);
            c.lineTo(14, 14);
            c.lineTo(14, 21);
            c.lineTo(19, 21);
            c.lineTo(19, 9);
        } else if (route === "live") {
            c.roundedRect(3, 6, 18, 13, 2, 2);
            c.moveTo(8, 2);
            c.lineTo(12, 6);
            c.lineTo(16, 2);
            c.moveTo(8, 22);
            c.lineTo(16, 22);
        } else if (route === "movies") {
            c.rect(3, 4, 18, 16);
            c.moveTo(7, 4);
            c.lineTo(7, 20);
            c.moveTo(17, 4);
            c.lineTo(17, 20);
            for (let y = 8; y <= 16; y += 4) {
                c.moveTo(3, y);
                c.lineTo(7, y);
                c.moveTo(17, y);
                c.lineTo(21, y);
            }
        } else if (route === "series") {
            c.roundedRect(3, 7, 18, 14, 2, 2);
            c.moveTo(6, 3);
            c.lineTo(18, 3);
            c.moveTo(9, 11);
            c.lineTo(15, 14);
            c.lineTo(9, 17);
            c.closePath();
        } else if (route === "favorites") {
            c.moveTo(12, 21);
            c.bezierCurveTo(9, 18, 2, 13, 2, 8);
            c.bezierCurveTo(2, 2, 9, 1, 12, 6);
            c.bezierCurveTo(15, 1, 22, 2, 22, 8);
            c.bezierCurveTo(22, 13, 15, 18, 12, 21);
        } else {
            c.arc(12, 7, 4, 0, Math.PI * 2);
            c.moveTo(4, 21);
            c.bezierCurveTo(4, 12, 20, 12, 20, 21);
        }
        c.stroke();
        c.restore();
    }
}
