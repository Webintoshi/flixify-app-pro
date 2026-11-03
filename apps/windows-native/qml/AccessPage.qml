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
    property bool qrSurfaceVisible: Qt.application.state === Qt.ApplicationActive && visible && !repository.bootstrapping && !repository.authenticated && !repository.welcomeVisible
    property bool qrLifecycleReady: false
    property bool qrLifecycleActive: false
    function reconcileQrSurface() {
        if (!qrLifecycleReady || qrLifecycleActive === qrSurfaceVisible)
            return;
        qrLifecycleActive = qrSurfaceVisible;
        if (qrLifecycleActive) repository.startDeviceLogin();
        else repository.cancelDeviceLogin();
    }
    function startPairing() {
        qrLifecycleActive = qrSurfaceVisible;
        repository.startDeviceLogin();
    }
    function cancelPairing() {
        qrLifecycleActive = qrSurfaceVisible;
        repository.cancelDeviceLogin();
    }
    onQrSurfaceVisibleChanged: Qt.callLater(access.reconcileQrSurface)
    Component.onCompleted: {
        qrLifecycleReady = true;
        Qt.callLater(access.reconcileQrSurface);
    }
    Component.onDestruction: {
        qrLifecycleReady = false;
        repository.cancelDeviceLogin();
    }
    function pairingMessage() {
        switch (repository.pairingStatus) {
        case "starting": return "QR hazırlanıyor…";
        case "pending": return "Telefonundan QR’ı okut, eşleşen kodu kontrol edip onayla.";
        case "retrying": return "Bağlantı yeniden deneniyor…";
        case "delivery": return "Onayın sonucu kontrol ediliyor…";
        case "denied": return "Telefonundan girişe izin verilmedi.";
        case "expired": return "QR’ın süresi doldu. Yeni QR oluşturabilirsin.";
        case "cancelled": return "QR girişi iptal edildi.";
        case "error": return "QR hazırlanamadı. Yeniden dene veya kullanıcı kodunla giriş yap.";
        case "authorized": return "Giriş onaylandı. Hesabın yükleniyor…";
        case "bootstrap_error": return "Giriş kaydedildi. Hesap bilgilerini yeniden yükleyebilirsin.";
        case "complete": return "Bu QR tamamlandı. Hesabın açılmadıysa yeni QR oluşturabilirsin.";
        default: return "QR girişini başlat veya kullanıcı kodunla devam et.";
        }
    }
    ScrollView {
        anchors.fill: parent
        visible: !repository.welcomeVisible
        clip: true
        contentWidth: availableWidth
        ColumnLayout {
            width: Math.min(850, access.width - 70)
            x: (access.width - width) / 2
            spacing: 24
            Item { Layout.preferredHeight: 20 }
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
            RowLayout {
                Layout.alignment: Qt.AlignHCenter
                spacing: 45
                ColumnLayout {
                    Layout.preferredWidth: 310
                    Layout.alignment: Qt.AlignTop
                    spacing: 16
                    Text {
                        text: "Telefonunla giriş yap"
                        color: "#F5F6F8"
                        font.pixelSize: 21
                        font.weight: Font.Bold
                        Layout.alignment: Qt.AlignHCenter
                    }
                    Rectangle {
                        color: "white"
                        Layout.alignment: Qt.AlignHCenter
                        Layout.preferredWidth: 220
                        Layout.preferredHeight: 220
                        Image {
                            anchors.fill: parent
                            anchors.margins: 12
                            source: repository.pairingQrSource
                            fillMode: Image.PreserveAspectFit
                            smooth: false
                            cache: false
                            visible: !!source.toString()
                            Accessible.name: "Telefonunla okutabileceğin Flixify giriş QR kodu"
                            Accessible.role: Accessible.Graphic
                        }
                        BusyIndicator { anchors.centerIn: parent; running: repository.pairingStatus === "starting"; visible: running; palette.dark: "black" }
                    }
                    Text {
                        text: repository.pairingCode
                        visible: !!text
                        color: "#F5F6F8"
                        font.family: "Consolas"
                        font.pixelSize: 26
                        font.weight: Font.DemiBold
                        Layout.alignment: Qt.AlignHCenter
                        Accessible.name: "Eşleştirme kodu " + text
                    }
                    Text {
                        visible: !!repository.pairingCode
                        text: repository.pairingRemaining > 0 ? "Kalan süre: " + repository.pairingRemaining + " sn" : "Onay sonucu bekleniyor"
                        color: "#A7B0BE"
                        font.pixelSize: 13
                        Layout.alignment: Qt.AlignHCenter
                    }
                    Text {
                        text: access.pairingMessage()
                        color: "#A7B0BE"
                        font.pixelSize: 14
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                    RowLayout {
                        Layout.alignment: Qt.AlignHCenter
                        ActionButton {
                            objectName: "pairingBootstrapRetry"
                            text: repository.busy ? "Hesabın yükleniyor…" : "Hesabımı yeniden yükle"
                            visible: repository.authenticated
                            enabled: !repository.busy
                            onClicked: repository.retryDeviceBootstrap()
                        }
                        ActionButton {
                            objectName: "pairingRenew"
                            text: repository.pairingCode ? "QR’ı yenile" : "QR ile giriş yap"
                            visible: !repository.authenticated
                            enabled: repository.pairingStatus !== "starting"
                            onClicked: { code.clear(); access.startPairing(); }
                        }
                        ActionButton {
                            objectName: "pairingCancel"
                            visible: !!repository.pairingCode
                            text: "İptal"
                            quiet: true
                            onClicked: { access.cancelPairing(); code.forceActiveFocus(); }
                        }
                    }
                }
                ColumnLayout {
                    Layout.preferredWidth: 350
                    Layout.alignment: Qt.AlignTop
                    spacing: 22
                    Text {
                        text: "Kullanıcı kodunla giriş yap"
                        color: "#F5F6F8"
                        font.pixelSize: 21
                        font.weight: Font.Bold
                        Layout.alignment: Qt.AlignHCenter
                    }
                    Text {
                        text: "Mevcut 16 karakterli kullanıcı kodunla devam et."
                        color: "#A7B0BE"
                        font.pixelSize: 14
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 9
                        Text { text: "Kullanıcı kodu"; color: "#A7B0BE"; font.pixelSize: 13 }
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
                            enabled: !repository.busy && !repository.authenticated
                            Accessible.name: "16 karakterli kullanıcı kodu"
                            background: Rectangle {
                                color: "#13171E"
                                radius: 10
                                border.color: code.activeFocus ? "#F5F6F8" : "#343D4B"
                                border.width: code.activeFocus ? 2 : 1
                            }
                            onTextEdited: { if (text.length > 0) access.cancelPairing(); }
                            onAccepted: access.submit()
                            Component.onCompleted: forceActiveFocus()
                        }
                    }
                    ActionButton {
                        objectName: "loginAction"
                        text: repository.busy ? "Giriş yapılıyor…" : "Giriş yap"
                        prominent: true
                        Layout.fillWidth: true
                        implicitHeight: 48
                        enabled: !repository.authenticated && !repository.busy && code.text.trim().length === 16
                        onClicked: access.submit()
                    }
                    ActionButton {
                        text: "Hesap oluştur"
                        quiet: true
                        Layout.alignment: Qt.AlignHCenter
                        onClicked: repository.openWebsite("register")
                    }
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
            Text { text: "Windows için Flixify Pro"; color: "#A7B0BE"; font.pixelSize: 12; Layout.alignment: Qt.AlignHCenter }
            Item { Layout.preferredHeight: 25 }
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
