import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Flixify.Native 1.0

ApplicationWindow {
    width: 1440
    height: 900
    visible: true
    title: "Flixify Native Qt"
    color: "#05060a"

    Connections {
        target: apiClient
        function onLoginSucceeded() {
            apiClient.fetchLiveCatalog(1, 300, "")
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 16

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 84
            radius: 18
            color: "#0d1119"
            border.color: "#272d3a"

            RowLayout {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 14

                TextField {
                    id: codeField
                    Layout.preferredWidth: 260
                    placeholderText: "Kryptonite kodu"
                    color: "#f4f7fb"
                    selectByMouse: true
                }

                Button {
                    text: "Login"
                    onClicked: apiClient.loginByCode(codeField.text)
                }

                Button {
                    text: "Katalog Yenile"
                    enabled: apiClient.accessToken.length > 0
                    onClicked: apiClient.fetchLiveCatalog(1, 300, "")
                }

                Item {
                    Layout.fillWidth: true
                }

                Column {
                    spacing: 4
                    Text {
                        text: "State: " + playbackController.state
                        color: "#f4f7fb"
                    }
                    Text {
                        text: "Decoder: " + playbackController.decoderMode
                        color: "#a7b1c2"
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 18

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 28
                color: "#090b11"
                border.color: "#202737"

                NativeVideoSurface {
                    anchors.fill: parent
                    anchors.margins: 10
                    onSurfaceHandleChanged: playbackController.setVideoSurfaceHandle(surfaceHandle)
                }

                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.top: parent.top
                    anchors.topMargin: 18
                    radius: 16
                    color: "#1b2331"
                    opacity: playbackController.lastError.length > 0 ? 0.95 : 0.82
                    width: errorText.implicitWidth + 32
                    height: errorText.implicitHeight + 22

                    Text {
                        id: errorText
                        anchors.centerIn: parent
                        text: playbackController.lastError.length > 0 ? playbackController.lastError : "libVLC native playback hazir"
                        color: playbackController.lastError.length > 0 ? "#ffd8d8" : "#d8e2ff"
                        wrapMode: Text.WordWrap
                    }
                }
            }

            Rectangle {
                Layout.preferredWidth: 420
                Layout.fillHeight: true
                radius: 28
                color: "#0b0e14"
                border.color: "#202737"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: 14

                    Text {
                        text: "Canli Kanallar"
                        color: "#f4f7fb"
                        font.pixelSize: 26
                        font.bold: true
                    }

                    ListView {
                        id: channelList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        clip: true
                        spacing: 10
                        model: apiClient.liveChannels

                        delegate: ItemDelegate {
                            width: channelList.width
                            highlighted: modelData.id === playbackController.activeChannelId
                            onClicked: playbackController.playChannel(modelData.id)

                            background: Rectangle {
                                radius: 18
                                color: parent.highlighted ? "#ff223d" : "#131923"
                                border.color: parent.highlighted ? "#ff5d74" : "#2a3140"
                            }

                            contentItem: Column {
                                spacing: 2
                                Text {
                                    text: modelData.title
                                    color: "#f4f7fb"
                                    font.pixelSize: 18
                                    font.bold: true
                                }
                                Text {
                                    text: (modelData.variantGroupKey || "") + "  rank:" + (modelData.qualityRank || -1)
                                    color: "#b8c1d2"
                                    font.pixelSize: 13
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
