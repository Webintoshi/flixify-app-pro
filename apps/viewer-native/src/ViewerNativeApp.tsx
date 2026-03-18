import React, { useEffect, useState } from "react";
import {
  Linking,
  SafeAreaView,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import {
  createInMemoryStorageAdapter,
  loginRoute,
  registerRoute,
  useViewerCore,
  viewerRoutes
} from "@flixify/viewer-core";

type RouteKey = (typeof viewerRoutes)[number];
type AuthScreen = typeof loginRoute | typeof registerRoute;

const storage = createInMemoryStorageAdapter();
const revealAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
}

function formatCodeBlocks(value: string) {
  const normalized = normalizeCode(value);
  if (!normalized) {
    return "---- ---- ---- ----";
  }

  const groups = normalized.match(/.{1,4}/g);
  return groups ? groups.join(" ") : normalized;
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const backgroundColor = disabled ? "#35373b" : secondary ? "#1c1c1c" : "#e50914";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor
      }}
    >
      <Text style={{ color: "white", fontWeight: "800", textAlign: "center" }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ViewerNativeApp() {
  const [screen, setScreen] = useState<RouteKey>("/canli-tv");
  const [authScreen, setAuthScreen] = useState<AuthScreen>(loginRoute);
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("Apple TV");
  const [issuedCode, setIssuedCode] = useState("");
  const [revealedCount, setRevealedCount] = useState(0);
  const [scrambleSeed, setScrambleSeed] = useState(0);
  const [codeAcknowledged, setCodeAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [premiumDismissed, setPremiumDismissed] = useState(false);

  const core = useViewerCore({
    baseUrl: "http://localhost:4000",
    storage,
    platform: "tvos",
    defaultDeviceName: "Apple TV"
  });
  const me = core.me;

  useEffect(() => {
    if (!issuedCode) {
      return;
    }

    setRevealedCount(0);
    setScrambleSeed(0);
    setCodeAcknowledged(false);
    setCopied(false);

    let cursor = 0;
    const timer = setInterval(() => {
      cursor += 1;
      setRevealedCount(Math.min(cursor, issuedCode.length));
      setScrambleSeed((seed) => seed + 1);

      if (cursor >= issuedCode.length) {
        clearInterval(timer);
      }
    }, 72);

    return () => {
      clearInterval(timer);
    };
  }, [issuedCode]);

  useEffect(() => {
    if (core.me?.user.hasActiveSubscription) {
      setPremiumDismissed(false);
    }
  }, [core.me?.user.hasActiveSubscription]);

  const animatedCode = issuedCode
    ? issuedCode
        .split("")
        .map((char, index) =>
          index < revealedCount ? char : revealAlphabet[(scrambleSeed + index * 9) % revealAlphabet.length]
        )
        .join("")
    : "";
  const isRevealing = Boolean(issuedCode) && revealedCount < issuedCode.length;
  const canUseCodeActions = Boolean(issuedCode) && !isRevealing;

  async function handleIssueCode() {
    const nextCode = await core.issueAnonCode(deviceName);
    if (!nextCode) {
      return;
    }

    setIssuedCode(normalizeCode(nextCode));
  }

  async function handleCopyCode() {
    if (!issuedCode) {
      return;
    }

    await Share.share({
      title: "Flixify Pro Hesap Numarasi",
      message: `Kod: ${formatCodeBlocks(issuedCode)}\nTam kod: ${issuedCode}`
    });
    setCopied(true);
  }

  async function handleDownloadCode() {
    if (!issuedCode) {
      return;
    }

    await Share.share({
      title: "Flixify Pro Kod Dosyasi",
      message: `Flixify Pro Hesap Numarasi\nKod: ${formatCodeBlocks(issuedCode)}\nTam kod: ${issuedCode}`
    });
  }

  function handleContinueToLogin() {
    if (!canUseCodeActions || !codeAcknowledged) {
      return;
    }

    setCode(issuedCode);
    setAuthScreen(loginRoute);
  }

  if (!core.session || !me) {
    const normalizedCode = normalizeCode(code);

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#050505" }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
          <View
            style={{
              backgroundColor: "#121418",
              borderRadius: 24,
              padding: 22,
              gap: 14
            }}
          >
            <Text style={{ color: "white", fontSize: 30, fontWeight: "900", textAlign: "center" }}>
              FLIXIFY PRO
            </Text>
            <Text style={{ color: "#b7b7b2", textAlign: "center" }}>
              {authScreen === registerRoute
                ? "Tek kullanimlik hesap numaranizi olusturun."
                : "16 haneli hesap numaraniz ile giris yapin."}
            </Text>

            {authScreen === registerRoute ? (
              <View style={{ gap: 12 }}>
                <TextInput
                  value={deviceName}
                  onChangeText={setDeviceName}
                  style={{
                    backgroundColor: "#1f1f1f",
                    color: "white",
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12
                  }}
                  placeholder="Apple TV"
                  placeholderTextColor="#888"
                />

                {!issuedCode ? (
                  <ActionButton
                    label={core.busy ? "Hesap Numarasi Olusturuluyor" : "Hesap Numarasi Olustur"}
                    onPress={() => void handleIssueCode()}
                    disabled={core.busy}
                  />
                ) : (
                  <View
                    style={{
                      borderWidth: 2,
                      borderColor: "#f40612",
                      borderStyle: "dashed",
                      borderRadius: 18,
                      backgroundColor: "#0b0d12",
                      padding: 16,
                      gap: 10
                    }}
                  >
                    <Text
                      style={{
                        color: "#ff2532",
                        fontSize: 30,
                        fontWeight: "900",
                        textAlign: "center",
                        letterSpacing: 2.2
                      }}
                    >
                      {formatCodeBlocks(animatedCode)}
                    </Text>
                    <Text style={{ color: "#ff6c72", textAlign: "center" }}>
                      {isRevealing ? "• Sifre cozuluyor..." : "• Kod hazir"}
                    </Text>
                  </View>
                )}

                {issuedCode ? (
                  <>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <ActionButton
                          label={copied ? "Kopyalandi" : "Kopyala"}
                          secondary
                          onPress={() => void handleCopyCode()}
                          disabled={!canUseCodeActions}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ActionButton
                          label="Indir"
                          secondary
                          onPress={() => void handleDownloadCode()}
                          disabled={!canUseCodeActions}
                        />
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => setCodeAcknowledged((current) => !current)}
                      style={{
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.2)",
                        paddingHorizontal: 12,
                        paddingVertical: 12
                      }}
                      disabled={!canUseCodeActions}
                    >
                      <Text style={{ color: "white" }}>
                        {codeAcknowledged ? "☑" : "☐"} Hesap numarami kaydettigimi onayliyorum.
                      </Text>
                    </TouchableOpacity>

                    <ActionButton
                      label="Oturum Ac"
                      onPress={handleContinueToLogin}
                      disabled={!canUseCodeActions || !codeAcknowledged}
                    />
                  </>
                ) : null}

                <TouchableOpacity onPress={() => setAuthScreen(loginRoute)}>
                  <Text style={{ color: "#ff4d57", textAlign: "center", fontWeight: "700" }}>
                    Zaten hesabin var mi? Giris Yap
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <TextInput
                  value={code}
                  onChangeText={(value: string) => setCode(normalizeCode(value))}
                  style={{
                    backgroundColor: "#1f1f1f",
                    color: "white",
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    fontSize: 18,
                    letterSpacing: 3
                  }}
                  placeholder="ABCD 1234 EFGH 5678"
                  placeholderTextColor="#888"
                  autoCapitalize="characters"
                />
                <Text style={{ color: "#9ea0a6", textAlign: "right" }}>{normalizedCode.length}/16</Text>
                <ActionButton
                  label={core.busy ? "Giris Yapiliyor" : "Giris Yap"}
                  onPress={() => void core.loginByCode(normalizedCode, deviceName)}
                  disabled={core.busy || normalizedCode.length !== 16}
                />
                <TouchableOpacity onPress={() => setAuthScreen(registerRoute)}>
                  <Text style={{ color: "#ff4d57", textAlign: "center", fontWeight: "700" }}>
                    Hesabin yok mu? Kayit Ol
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {core.error ? <Text style={{ color: "#ff8888" }}>{core.error}</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (core.viewState === "blocked") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#050505" }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 18 }}>
          <View style={{ gap: 10, backgroundColor: "#121212", borderRadius: 20, padding: 20 }}>
            <Text style={{ color: "white", fontSize: 24, fontWeight: "800" }}>Erisim Durdu</Text>
            <Text style={{ color: "#b7b7b2" }}>
              Hesabiniz engelli durumda. Destek ekibiyle iletisime gecin.
            </Text>
            <ActionButton
              label="WhatsApp ile Iletisime Gec"
              onPress={() => void Linking.openURL(me.contact.whatsapp)}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isProfileChildScreen = screen === "/paketler" || screen === "/odemeler" || screen === "/iletisim";

  const currentItems =
    screen === "/canli-tv"
      ? core.catalogs.live.map((item) => `${item.title} • ${item.playbackAllowed ? "Oynat" : "Kilitli"}`)
      : screen === "/filmler"
        ? core.catalogs.movies.map((item) => `${item.title} • ${item.playbackAllowed ? "Oynat" : "Kilitli"}`)
        : screen === "/diziler"
          ? core.catalogs.series.flatMap((item) =>
              item.seasons.flatMap((season) =>
                season.episodes.map(
                  (episode) => `${item.title} / ${episode.title} • ${episode.playbackAllowed ? "Oynat" : "Kilitli"}`
                )
              )
            )
          : screen === "/paketler"
            ? core.packages.map((item) => `${item.title} • ${item.durationMonths} ay`)
            : screen === "/odemeler"
              ? core.paymentRequests.map((item) => `${item.packageTitle} • ${item.status}`)
              : screen === "/ayarlar"
                ? core.deviceSessions.map((item) => `${item.deviceName ?? "Cihaz"} • ${item.platform ?? "platform yok"}`)
                : [`WhatsApp: ${me.contact.whatsapp}`, `Telegram: ${me.contact.telegram}`];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#050505" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
        <View style={{ gap: 12 }}>
          <Text style={{ color: "white", fontSize: 28, fontWeight: "700" }}>Flixify Native</Text>
          <Text style={{ color: "#b7b7b2" }}>
            Durum: {me.user.hasActiveSubscription && me.user.activePackage ? `${me.user.activePackage.title} / ${me.user.activePackage.remainingDays} gun` : "Paket aktif degil"}
          </Text>
        </View>

        {!me.user.hasActiveSubscription && !premiumDismissed ? (
          <View style={{ gap: 12, backgroundColor: "#13161c", borderRadius: 20, padding: 20 }}>
            <Text style={{ color: "white", fontSize: 24, fontWeight: "800" }}>Premium Erisim</Text>
            <Text style={{ color: "#b7b7b2" }}>
              Tum iceriklere erismek icin aktif bir paket satin alin.
            </Text>
            <ActionButton
              label={core.busy ? "Test Talebi Gonderiliyor" : "Test Yapmak Istiyorum"}
              onPress={() => void core.requestTrial("Native cihazdan test talebi")}
              disabled={core.busy}
            />
            <ActionButton
              label="WhatsApp ile Iletisime Gec"
              secondary
              onPress={() => void Linking.openURL(me.contact.whatsapp)}
            />
            <ActionButton label="Paket Satin Al" secondary onPress={() => setScreen("/paketler")} />
            <TouchableOpacity onPress={() => setPremiumDismissed(true)}>
              <Text style={{ color: "#9ea0a6", textAlign: "center" }}>Simdi degil, daha sonra hatirlat</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ gap: 12, flexDirection: "row", flexWrap: "wrap" }}>
          {viewerRoutes.map((item) => (
            <TouchableOpacity
              key={item}
              onPress={() => setScreen(item)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                backgroundColor: screen === item ? "#e50914" : "#1c1c1c",
                borderRadius: 999
              }}
            >
              <Text style={{ color: "white" }}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ gap: 12, backgroundColor: "#121212", borderRadius: 20, padding: 20 }}>
          <Text style={{ color: "white", fontSize: 20, fontWeight: "600" }}>{screen}</Text>
          {isProfileChildScreen ? (
            <ActionButton label="Geri (Profil)" secondary onPress={() => setScreen("/ayarlar")} />
          ) : null}
          <TouchableOpacity onPress={() => setScreen("/ayarlar")}>
            <Text style={{ color: "#b7b7b2" }}>Kod: {core.codeLabel} (Profil)</Text>
          </TouchableOpacity>
          {currentItems.map((item) => (
            <Text key={item} style={{ color: "#e8e8e2" }}>
              {item}
            </Text>
          ))}
        </View>

        {core.notice ? <Text style={{ color: "#7de3b4" }}>{core.notice}</Text> : null}
        {core.error ? <Text style={{ color: "#ff8888" }}>{core.error}</Text> : null}

        <ActionButton label="Cikis Yap" secondary onPress={() => void core.logout()} />
      </ScrollView>
    </SafeAreaView>
  );
}
