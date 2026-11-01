import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: access
    property bool dual: false
    property var offer: repository.welcome || ({})
    function countText(value, fallback) {
        return value > 0 ? Number(value).toLocaleString(Qt.locale("tr_TR"), "f", 0) + " " + fallback : fallback;
    }
    function price() {
        let amount = dual ? offer.dualPriceMinor : offer.singlePriceMinor;
        return amount > 0 ? Number(amount / 100).toLocaleCurrencyString(Qt.locale("tr_TR"), "₺") : "";
    }
    function submit() {
        if (repository.busy || code.text.trim().length !== 16)
            return;
        let value = code.text.trim();
        code.clear();
        repository.login(value);
    }
    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(430, parent.width - 80)
        spacing: 23
        visible: !repository.welcomeVisible
        Image {
            source: "qrc:/brand/flixify-logo.png"
            fillMode: Image.PreserveAspectFit
            Layout.alignment: Qt.AlignHCenter
            Layout.preferredWidth: 240
            Layout.preferredHeight: 80
            sourceSize.width: 480
        }
        Text {
            text: "İçeriklerin. Tek yerde."
            color: "#F5F6F8"
            font.pixelSize: 30
            font.weight: Font.Bold
            Layout.alignment: Qt.AlignHCenter
        }
        Text {
            text: "Mevcut 16 karakterli kullanıcı kodunla giriş yap."
            color: "#A7B0BE"
            font.pixelSize: 14
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 9
            Text {
                text: "Kullanıcı kodu"
                color: "#A7B0BE"
                font.pixelSize: 13
            }
            TextField {
                id: code
                objectName: "loginCode"
                Layout.fillWidth: true
                implicitHeight: 62
                placeholderText: "16 karakterli kodun"
                echoMode: TextInput.Password
                passwordCharacter: "•"
                maximumLength: 16
                color: "#F5F6F8"
                placeholderTextColor: "#8590A0"
                font.family: "Consolas"
                font.pixelSize: 22
                padding: 18
                selectByMouse: true
                enabled: !repository.busy
                Accessible.name: "16 karakterli kullanıcı kodu"
                background: Rectangle {
                    color: "#13171E"
                    radius: 10
                    border.color: code.activeFocus ? "#F5F6F8" : "#343D4B"
                    border.width: code.activeFocus ? 2 : 1
                }
                onAccepted: access.submit()
                Component.onCompleted: forceActiveFocus()
            }
        }
        Text {
            visible: !!repository.error
            text: repository.error
            color: "#F5F6F8"
            font.pixelSize: 13
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            Accessible.role: Accessible.AlertMessage
        }
        ActionButton {
            objectName: "loginAction"
            text: repository.busy ? "Giriş yapılıyor…" : "Giriş yap"
            prominent: true
            Layout.fillWidth: true
            implicitHeight: 48
            enabled: !repository.busy && code.text.trim().length === 16
            onClicked: access.submit()
        }
        ActionButton {
            text: "Hesap oluştur"
            quiet: true
            Layout.alignment: Qt.AlignHCenter
            onClicked: repository.openWebsite("register")
        }
        Text {
            text: "Windows için Flixify Pro"
            color: "#A7B0BE"
            font.pixelSize: 12
            Layout.alignment: Qt.AlignHCenter
        }
    }
    ScrollView {
        anchors.fill: parent
        visible: repository.welcomeVisible
        clip: true
        contentWidth: availableWidth
        ColumnLayout {
            width: access.width - 80
            x: 40
            spacing: 23
            Item {
                Layout.preferredHeight: 12
            }
            Image {
                source: "qrc:/brand/flixify-logo.png"
                fillMode: Image.PreserveAspectFit
                Layout.alignment: Qt.AlignHCenter
                Layout.preferredWidth: 180
                Layout.preferredHeight: 55
            }
            Text {
                text: "Güzel bir başlangıç yapalım."
                color: "#F5F6F8"
                font.pixelSize: 34
                font.weight: Font.Bold
                Layout.alignment: Qt.AlignHCenter
            }
            Text {
                text: "Denemeye devam et veya ilk ayına özel fiyatını seç."
                color: "#A7B0BE"
                font.pixelSize: 14
                Layout.alignment: Qt.AlignHCenter
            }
            RowLayout {
                Layout.maximumWidth: 900
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignHCenter
                spacing: 22
                Repeater {
                    model: 2
                    delegate: Rectangle {
                        id: offerCard
                        required property int index
                        property bool free: index === 0
                        Layout.fillWidth: true
                        Layout.preferredHeight: 444
                        color: free ? "#13171E" : "#290C12"
                        radius: 20
                        border.color: free ? "#929BA8" : "#FF3545"
                        border.width: 1.5
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 26
                            spacing: 17
                            RowLayout {
                                Layout.fillWidth: true
                                Text {
                                    text: offerCard.free ? "3 Saat" : "1 Ay"
                                    font.pixelSize: 26
                                    font.weight: Font.Bold
                                    color: "#F5F6F8"
                                    Layout.fillWidth: true
                                }
                                Rectangle {
                                    visible: !offerCard.free
                                    color: "#FF3545"
                                    radius: 6
                                    Layout.preferredWidth: 98
                                    Layout.preferredHeight: 28
                                    Text {
                                        anchors.centerIn: parent
                                        text: "%50 İNDİRİM"
                                        color: "white"
                                        font.pixelSize: 11
                                        font.weight: Font.Bold
                                    }
                                }
                            }
                            Text {
                                text: offerCard.free ? "Ücretsiz" : access.price() || "İlk aya özel fiyat"
                                color: "#F5F6F8"
                                font.pixelSize: offerCard.free || access.price() ? 36 : 25
                                font.weight: Font.Bold
                            }
                            Text {
                                text: offerCard.free ? "Flixify dünyasını keşfet." : "Bir ay boyunca favorilerinin keyfini çıkar."
                                color: "#A7B0BE"
                                font.pixelSize: 14
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 1
                                color: "#35404D"
                            }
                            Repeater {
                                model: [access.countText(access.offer.movies, "film"), access.countText(access.offer.live, "canlı kanal"), access.countText(access.offer.series, "dizi")]
                                delegate: Text {
                                    required property string modelData
                                    text: "✓   " + modelData
                                    color: "#F5F6F8"
                                    font.pixelSize: 14
                                }
                            }
                            Item {
                                Layout.fillHeight: true
                            }
                            CheckBox {
                                visible: !offerCard.free
                                text: "İki cihazda eşzamanlı izle"
                                checked: access.dual
                                palette.windowText: "#F5F6F8"
                                palette.buttonText: "#F5F6F8"
                                font.pixelSize: 12
                                onToggled: access.dual = checked
                            }
                            ActionButton {
                                objectName: offerCard.free ? "welcome-trial" : "welcome-monthly"
                                Layout.fillWidth: true
                                text: repository.busy ? "İşleniyor…" : offerCard.free ? "Ücretsiz denemeyi seç" : "İndirimli paketi seç"
                                prominent: !offerCard.free
                                light: offerCard.free
                                enabled: !repository.busy
                                onClicked: repository.chooseWelcome(!offerCard.free, access.dual ? 2 : 1)
                            }
                        }
                    }
                }
            }
            Text {
                text: repository.error || "Aylık paket ödemesi sitede, aynı kullanıcı kodunla tamamlanır."
                color: "#A7B0BE"
                font.pixelSize: 12
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
            Item {
                Layout.preferredHeight: 25
            }
        }
    }
}
