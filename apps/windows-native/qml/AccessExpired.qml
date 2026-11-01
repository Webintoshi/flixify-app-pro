import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: expired
    objectName: "expiredAccessPage"
    property var account: repository.account || ({})
    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true
        ColumnLayout {
            width: Math.min(expired.width - 80, 620)
            x: (expired.width - width) / 2
            spacing: 23
            Item { Layout.preferredHeight: 65 }
            Image { source: "qrc:/brand/flixify-logo.png"; fillMode: Image.PreserveAspectFit; Layout.preferredWidth: 220; Layout.preferredHeight: 75; Layout.alignment: Qt.AlignHCenter }
            Text { text: "İzleme erişimin"; color: "#F5F6F8"; font.pixelSize: 32; font.weight: Font.Bold; Layout.alignment: Qt.AlignHCenter }
            Text { text: expired.account.message || "Aktif izleme erişimin bulunmuyor."; color: "#A7B0BE"; font.pixelSize: 16; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; Layout.fillWidth: true }
            Rectangle {
                Layout.fillWidth: true; implicitHeight: details.implicitHeight + 40; color: "#13171E"; radius: 14
                ColumnLayout {
                    id: details
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 20; spacing: 12
                    Text { visible: !!expired.account.packageTitle; text: expired.account.packageTitle || ""; color: "#F5F6F8"; font.pixelSize: 19; font.weight: Font.DemiBold; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                    Text { text: "Kullanıcı kodu: •••• " + repository.codeSuffix; color: "#A7B0BE"; font.pixelSize: 14 }
                }
            }
            RowLayout {
                Layout.alignment: Qt.AlignHCenter; spacing: 12
                ActionButton { objectName: "expiredPackages"; text: "Paketleri görüntüle"; prominent: true; onClicked: repository.openWebsite("packages") }
                ActionButton { objectName: "expiredRefresh"; text: repository.busy ? "Denetleniyor…" : "Erişimimi yeniden denetle"; enabled: !repository.busy; onClicked: repository.refresh() }
            }
            Text { visible: !!repository.error; text: repository.error; color: "#F5F6F8"; font.pixelSize: 13; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; Layout.fillWidth: true }
            RowLayout {
                Layout.alignment: Qt.AlignHCenter; spacing: 12
                ActionButton { objectName: "expiredSupport"; text: "Destek"; quiet: true; onClicked: repository.openWebsite("support") }
                ActionButton { objectName: "expiredLogout"; text: "Çıkış yap"; quiet: true; onClicked: repository.logout() }
            }
            Item { Layout.preferredHeight: 40 }
        }
    }
}
