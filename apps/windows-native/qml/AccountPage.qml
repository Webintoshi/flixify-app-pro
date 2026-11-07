import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ScrollView {
    id: accountPage
    clip: true
    contentWidth: availableWidth
    property var account: repository.account || ({})
    ColumnLayout {
        width: accountPage.availableWidth - 60
        x: 30
        spacing: 27
        Item {
            Layout.preferredHeight: 0
        }
        Text {
            text: "Hesabım"
            color: "#F5F6F8"
            font.pixelSize: 32
            font.weight: Font.Bold
        }
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: accountInfo.implicitHeight + 52
            radius: 16
            color: "#13171E"
            ColumnLayout {
                id: accountInfo
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 26
                spacing: 14
                Text {
                    text: accountPage.account.packageTitle || "İzleme erişimi"
                    color: "#F5F6F8"
                    font.pixelSize: 25
                    font.weight: Font.Bold
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
                Text {
                    text: "Kullanıcı kodu: •••• " + repository.codeSuffix
                    color: "#A7B0BE"
                    font.pixelSize: 14
                }
                Text {
                    objectName: "accountTrialCountdown"
                    visible: repository.trialCountdownStatus !== "none"
                    text: repository.trialCountdownText
                    color: "#F5F6F8"
                    font.pixelSize: 24
                    font.weight: Font.DemiBold
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
                Text {
                    text: accountPage.account.canPlay ? accountPage.account.trial ? "✓  Deneme süren aktif" : "✓  Paketin aktif" : "Aktif paketin bulunmuyor"
                    color: "#F5F6F8"
                    font.pixelSize: 14
                }
                Text {
                    visible: repository.expiresAt > 0
                    text: "Bitiş: " + new Date(repository.expiresAt).toLocaleString(Qt.locale("tr_TR"), "d MMM yyyy HH:mm")
                    color: "#A7B0BE"
                    font.pixelSize: 14
                }
                Text {
                    visible: !!accountPage.account.message
                    text: accountPage.account.message || ""
                    color: "#A7B0BE"
                    font.pixelSize: 14
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }
        Flow {
            Layout.fillWidth: true
            spacing: 12
            ActionButton {
                text: "Paketleri görüntüle"
                prominent: true
                onClicked: repository.openWebsite("packages")
            }
            ActionButton {
                text: repository.busy ? "Yenileniyor…" : "Paketimi yenile"
                enabled: !repository.busy
                onClicked: repository.refresh()
            }
        }
        Text {
            visible: !!repository.error
            text: repository.error
            color: "#F5F6F8"
            font.pixelSize: 13
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: settings.implicitHeight + 48
            radius: 16
            color: "#13171E"
            ColumnLayout {
                id: settings
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 24
                spacing: 17
                Text {
                    text: "Uygulama"
                    color: "#F5F6F8"
                    font.pixelSize: 21
                    font.weight: Font.Bold
                }
                RowLayout {
                    Layout.fillWidth: true
                    Text {
                        text: "Flixify Pro " + appVersion
                        color: "#F5F6F8"
                        font.pixelSize: 14
                        Layout.fillWidth: true
                    }
                    ActionButton {
                        text: "Güncellemeler"
                        onClicked: repository.openWebsite("downloads")
                    }
                }
                CheckBox {
                    text: "Afiş geçişlerinde ses çal"
                    checked: repository.posterSoundEnabled
                    palette.windowText: "#F5F6F8"
                    palette.buttonText: "#F5F6F8"
                    font.pixelSize: 14
                    onToggled: repository.setPosterSoundEnabled(checked)
                }
                Text {
                    text: "Katalog ve favoriler önbellekte tutulur; video dosyası indirilmez."
                    color: "#A7B0BE"
                    font.pixelSize: 13
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
                Text {
                    text: "Oynatıcı: Boşluk ile duraklat/başlat, sağ/sol ile 10 saniye sar, Esc ile geri dön."
                    color: "#A7B0BE"
                    font.pixelSize: 13
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            ActionButton {
                text: "Destek"
                quiet: true
                onClicked: repository.openWebsite("support")
            }
            Item {
                Layout.fillWidth: true
            }
            ActionButton {
                text: "Çıkış yap"
                onClicked: logoutDialog.open()
            }
        }
        Item {
            Layout.preferredHeight: 30
        }
    }
    Dialog {
        id: logoutDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        width: 420
        modal: true
        focus: true
        title: "Oturumu kapat"
        palette.windowText: "#F5F6F8"
        background: Rectangle {
            color: "#13171E"
            radius: 14
            border.color: "#343D4B"
        }
        contentItem: ColumnLayout {
            spacing: 24
            Text {
                text: "Bu bilgisayarda oturumu kapatmak istiyor musun?"
                color: "#F5F6F8"
                font.pixelSize: 15
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
            RowLayout {
                Layout.alignment: Qt.AlignRight
                spacing: 12
                ActionButton {
                    text: "Vazgeç"
                    onClicked: logoutDialog.close()
                }
                ActionButton {
                    text: "Çıkış yap"
                    prominent: true
                    onClicked: {
                        logoutDialog.close();
                        repository.logout();
                    }
                }
            }
        }
    }
}
