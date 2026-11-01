#include "catalog.h"
#include <QRegularExpression>
#include <QDateTime>
#include <QTimeZone>
#include <QCollator>
#include <QMap>
#include <algorithm>
#include <stdexcept>
#include <tuple>
#include <cmath>
#include <array>
#include <functional>
namespace {
using namespace Catalog;
// Station metadata mirrors FlixifyCore/LiveLineupData.swift.
static const QMap<QString, double> referencePositions = {
{QString::fromUtf8("TV+ Keşfet Aksiyon"),1.0},
{QString::fromUtf8("TV+ Keşfet Drama"),2.0},
{QString::fromUtf8("FX"),3.0},
{QString::fromUtf8("tabii TV"),7.0},
{QString::fromUtf8("SİNEMA YERLİ"),9.0},
{QString::fromUtf8("SİNEMA TV"),10.0},
{QString::fromUtf8("SİNEMA TV AKSİYON"),11.0},
{QString::fromUtf8("SİNEMA KOMEDİ"),12.0},
{QString::fromUtf8("SİNEMA AİLE"),13.0},
{QString::fromUtf8("SİNEMA TV 1001"),14.0},
{QString::fromUtf8("SİNEMA YERLİ 2"),15.0},
{QString::fromUtf8("SİNEMA TV 2"),16.0},
{QString::fromUtf8("SİNEMA AKSİYON 2"),17.0},
{QString::fromUtf8("SİNEMA AİLE 2"),18.0},
{QString::fromUtf8("SİNEMA 1002"),19.0},
{QString::fromUtf8("COSMO EN"),20.0},
{QString::fromUtf8("TRT1"),21.0},
{QString::fromUtf8("KANAL D"),22.0},
{QString::fromUtf8("STAR TV"),23.0},
{QString::fromUtf8("ATV"),24.0},
{QString::fromUtf8("SHOW TV"),25.0},
{QString::fromUtf8("NOW"),26.0},
{QString::fromUtf8("TV8"),27.0},
{QString::fromUtf8("360"),28.0},
{QString::fromUtf8("A2"),29.0},
{QString::fromUtf8("TLC"),30.0},
{QString::fromUtf8("CNBC-E"),31.0},
{QString::fromUtf8("TV2"),32.0},
{QString::fromUtf8("KANAL 7"),34.0},
{QString::fromUtf8("BEYAZ TV"),36.0},
{QString::fromUtf8("TV100"),37.0},
{QString::fromUtf8("FLASH HABER"),38.0},
{QString::fromUtf8("DMAX"),39.0},
{QString::fromUtf8("BİZİM EV TV"),40.0},
{QString::fromUtf8("TV8,5"),41.0},
{QString::fromUtf8("GZT TV"),42.0},
{QString::fromUtf8("VAV TV"),43.0},
{QString::fromUtf8("TRT 2"),44.0},
{QString::fromUtf8("TV 4"),45.0},
{QString::fromUtf8("AS TV"),46.0},
{QString::fromUtf8("EKOL TV"),47.0},
{QString::fromUtf8("TURKHABER"),48.0},
{QString::fromUtf8("CNN TÜRK"),49.0},
{QString::fromUtf8("NTV"),50.0},
{QString::fromUtf8("HABERTÜRK"),51.0},
{QString::fromUtf8("A HABER"),52.0},
{QString::fromUtf8("TRT HABER"),53.0},
{QString::fromUtf8("24"),54.0},
{QString::fromUtf8("BLOOMBERG HT"),55.0},
{QString::fromUtf8("A PARA"),56.0},
{QString::fromUtf8("HALK TV"),57.0},
{QString::fromUtf8("TELE1"),58.0},
{QString::fromUtf8("HABER GLOBAL"),59.0},
{QString::fromUtf8("EKOTÜRK"),60.0},
{QString::fromUtf8("ÜLKE TV"),61.0},
{QString::fromUtf8("TGRT HABER"),62.0},
{QString::fromUtf8("TVNET"),63.0},
{QString::fromUtf8("AKİT TV"),64.0},
{QString::fromUtf8("BENGÜTÜRK"),65.0},
{QString::fromUtf8("ULUSAL KANAL"),66.0},
{QString::fromUtf8("KRT TV"),67.0},
{QString::fromUtf8("TV5"),68.0},
{QString::fromUtf8("SÖZCÜ TV"),69.0},
{QString::fromUtf8("TRT SPOR"),70.0},
{QString::fromUtf8("TRT SPOR YILDIZ"),71.0},
{QString::fromUtf8("A SPOR"),72.0},
{QString::fromUtf8("HT SPOR"),73.0},
{QString::fromUtf8("FB TV"),74.0},
{QString::fromUtf8("tabii spor"),75.0},
{QString::fromUtf8("S SPORT"),77.0},
{QString::fromUtf8("S SPORT 2"),78.0},
{QString::fromUtf8("EUROSPORT 1"),79.0},
{QString::fromUtf8("EUROSPORT 2"),80.0},
{QString::fromUtf8("SPORTS TV"),92.0},
{QString::fromUtf8("TV+ Ekstra"),94.0},
{QString::fromUtf8("TRT BELGESEL"),95.0},
{QString::fromUtf8("TARIH TV"),96.0},
{QString::fromUtf8("VIASAT EXPLORE"),97.0},
{QString::fromUtf8("NATIONAL GEOGRAPHIC"),98.0},
{QString::fromUtf8("BBC EARTH"),99.0},
{QString::fromUtf8("VIASAT HISTORY"),100.0},
{QString::fromUtf8("DISCOVERY CHANNEL"),101.0},
{QString::fromUtf8("NATIONAL GEOGRAPHIC WILD"),104.0},
{QString::fromUtf8("LOVE NATURE"),105.0},
{QString::fromUtf8("ENGLISH CLUB TV"),106.0},
{QString::fromUtf8("BABYTV"),118.0},
{QString::fromUtf8("DUCK TV"),119.0},
{QString::fromUtf8("DISNEY JUNIOR"),120.0},
{QString::fromUtf8("CBEEBIES"),121.0},
{QString::fromUtf8("MOONBUG KIDS TV"),122.0},
{QString::fromUtf8("CARTOONITO"),123.0},
{QString::fromUtf8("Nick JR"),125.0},
{QString::fromUtf8("NICKELODEON"),126.0},
{QString::fromUtf8("NICKTOONS"),127.0},
{QString::fromUtf8("AZOOMEE"),128.0},
{QString::fromUtf8("DA VINCI"),129.0},
{QString::fromUtf8("CARTOON NETWORK"),130.0},
{QString::fromUtf8("TRT ÇOCUK"),131.0},
{QString::fromUtf8("MİNİKA ÇOCUK"),132.0},
{QString::fromUtf8("MİNİKA GO"),133.0},
{QString::fromUtf8("SPACETOON"),134.0},
{QString::fromUtf8("TRT DIYANET COCUK"),135.0},
{QString::fromUtf8("TRT GENÇ"),136.0},
{QString::fromUtf8("CNN International"),137.0},
{QString::fromUtf8("BBC News"),138.0},
{QString::fromUtf8("Bloomberg"),139.0},
{QString::fromUtf8("A NEWS"),140.0},
{QString::fromUtf8("TRT World"),141.0},
{QString::fromUtf8("AL JAZEERA ENGLISH"),142.0},
{QString::fromUtf8("DEUTSCHE WELLE ENGLISH"),143.0},
{QString::fromUtf8("FRANCE 24 ENGLISH"),144.0},
{QString::fromUtf8("EURONEWS"),145.0},
{QString::fromUtf8("AL JAZEERA ARABIC"),146.0},
{QString::fromUtf8("FRANCE 24 ARABIC"),147.0},
{QString::fromUtf8("SKY NEWS ARABIA"),148.0},
{QString::fromUtf8("TV5 MONDE"),149.0},
{QString::fromUtf8("NUMBER1 TV"),170.0},
{QString::fromUtf8("POWER TV"),171.0},
{QString::fromUtf8("DREAM TÜRK"),172.0},
{QString::fromUtf8("NUMBER1 TURK"),173.0},
{QString::fromUtf8("POWER TURK"),174.0},
{QString::fromUtf8("TRT MÜZİK"),175.0},
{QString::fromUtf8("NR1 RAP"),177.0},
{QString::fromUtf8("TMB TV"),179.0},
{QString::fromUtf8("TİVİ6"),181.0},
{QString::fromUtf8("TYT TÜRK"),182.0},
{QString::fromUtf8("Bi Kanal"),183.0},
{QString::fromUtf8("MELTEM TV"),184.0},
{QString::fromUtf8("TRT 3"),203.0},
{QString::fromUtf8("TRT TÜRK"),204.0},
{QString::fromUtf8("TRT ARABI"),205.0},
{QString::fromUtf8("TRT AVAZ"),206.0},
{QString::fromUtf8("TRT KURDİ"),207.0},
{QString::fromUtf8("DİYANET TV"),208.0},
{QString::fromUtf8("SEMERKAND"),209.0},
{QString::fromUtf8("FM TV"),211.0},
{QString::fromUtf8("AL QURAN AL KAREEM"),213.0},
{QString::fromUtf8("AL SUNNAH AL NABAWIYAH"),214.0},
{QString::fromUtf8("TARIM TV"),215.0},
{QString::fromUtf8("ÇİFTÇİ TV"),216.0},
{QString::fromUtf8("AGRO TV"),218.0},
{QString::fromUtf8("TRT EBA"),221.0},
{QString::fromUtf8("KADIRGA TV"),248.0},
{QString::fromUtf8("KONTV"),250.0},
{QString::fromUtf8("KANAL 23"),251.0},
{QString::fromUtf8("KANAL V"),253.0},
{QString::fromUtf8("KANAL 26"),256.0},
{QString::fromUtf8("KANAL 33"),260.0},
{QString::fromUtf8("ON6"),261.0},
{QString::fromUtf8("BRT 1"),280.0},
{QString::fromUtf8("BRT 2"),281.0},
{QString::fromUtf8("KIBRIS GENC TV"),282.0},
{QString::fromUtf8("KIBRIS TV"),283.0},
{QString::fromUtf8("KANAL T"),284.0},
{QString::fromUtf8("KIBRIS ADA TV"),285.0},
{QString::fromUtf8("ŞÖMİNE PLUS"),300.0},
};
static const QMap<QString, QString> aliases = {
{QString::fromUtf8("Ulusal TV"),QString::fromUtf8("Ulusal Kanal")},
{QString::fromUtf8("Sözcü SZC TV"),QString::fromUtf8("Sözcü TV")},
{QString::fromUtf8("SZC TV"),QString::fromUtf8("Sözcü TV")},
{QString::fromUtf8("S Sport 1"),QString::fromUtf8("S Sport")},
{QString::fromUtf8("Nat Geo"),QString::fromUtf8("National Geographic")},
{QString::fromUtf8("NatGeo"),QString::fromUtf8("National Geographic")},
{QString::fromUtf8("Nat Geo Wild"),QString::fromUtf8("National Geographic Wild")},
{QString::fromUtf8("NatGeo Wild"),QString::fromUtf8("National Geographic Wild")},
{QString::fromUtf8("Disney JR"),QString::fromUtf8("Disney Junior")},
{QString::fromUtf8("Da Vinci Kids"),QString::fromUtf8("Da Vinci")},
{QString::fromUtf8("NUMBER 1"),QString::fromUtf8("NUMBER1 TV")},
{QString::fromUtf8("Power Türk TV"),QString::fromUtf8("POWER TURK")},
{QString::fromUtf8("Tivi6 (Ankaraİç Anadolu)"),QString::fromUtf8("TİVİ6")},
{QString::fromUtf8("TRT 3 SPOR"),QString::fromUtf8("TRT 3")},
{QString::fromUtf8("TRT 3 TBMM TV"),QString::fromUtf8("TRT 3")},
{QString::fromUtf8("Çiftçi Tv (İstanbulMarmara)"),QString::fromUtf8("ÇİFTÇİ TV")},
{QString::fromUtf8("KONYA KON TV"),QString::fromUtf8("KONTV")},
{QString::fromUtf8("Kanal 23 (ElazığDoğu Anadolu)"),QString::fromUtf8("KANAL 23")},
{QString::fromUtf8("ELAZIG Kanal 23"),QString::fromUtf8("KANAL 23")},
{QString::fromUtf8("Kanal V (AntalyaAkdeniz)"),QString::fromUtf8("KANAL V")},
{QString::fromUtf8("ANTALYA Kanal V"),QString::fromUtf8("KANAL V")},
{QString::fromUtf8("Kanal 26 (Eskişehirİç Anadolu)"),QString::fromUtf8("KANAL 26")},
{QString::fromUtf8("ON6TV (BursaMarmara)"),QString::fromUtf8("ON6")},
{QString::fromUtf8("Sinema Aksiyon"),QString::fromUtf8("SİNEMA TV AKSİYON")},
{QString::fromUtf8("Sinema 2"),QString::fromUtf8("SİNEMA TV 2")},
{QString::fromUtf8("Sinema 1001"),QString::fromUtf8("SİNEMA TV 1001")},
};
static const QMap<QString, QString> stationNames = {
{QString::fromUtf8("trtbir"),QString::fromUtf8("trt1")},
{QString::fromUtf8("show"),QString::fromUtf8("showtv")},
{QString::fromUtf8("nowtv"),QString::fromUtf8("now")},
{QString::fromUtf8("star"),QString::fromUtf8("startv")},
{QString::fromUtf8("kanal7tv"),QString::fromUtf8("kanal7")},
{QString::fromUtf8("tv2"),QString::fromUtf8("teve2")},
{QString::fromUtf8("24tv"),QString::fromUtf8("24")},
{QString::fromUtf8("cnnturktv"),QString::fromUtf8("cnnturk")},
{QString::fromUtf8("trtsporyildiztv"),QString::fromUtf8("trtsporyildiz")},
};
static const QMap<QString, QString> countryTitles = {
{QString::fromUtf8("tr"),QString::fromUtf8("Türkiye")},
{QString::fromUtf8("de"),QString::fromUtf8("Almanya")},
{QString::fromUtf8("fr"),QString::fromUtf8("Fransa")},
{QString::fromUtf8("gb"),QString::fromUtf8("İngiltere")},
{QString::fromUtf8("us"),QString::fromUtf8("ABD")},
{QString::fromUtf8("it"),QString::fromUtf8("İtalya")},
{QString::fromUtf8("es"),QString::fromUtf8("İspanya")},
{QString::fromUtf8("pt"),QString::fromUtf8("Portekiz")},
{QString::fromUtf8("bg"),QString::fromUtf8("Bulgaristan")},
{QString::fromUtf8("gr"),QString::fromUtf8("Yunanistan")},
{QString::fromUtf8("se"),QString::fromUtf8("İsveç")},
{QString::fromUtf8("dk"),QString::fromUtf8("Danimarka")},
{QString::fromUtf8("ru"),QString::fromUtf8("Rusya")},
{QString::fromUtf8("br"),QString::fromUtf8("Brezilya")},
{QString::fromUtf8("latam"),QString::fromUtf8("Latin Amerika")},
{QString::fromUtf8("arabic"),QString::fromUtf8("Arapça")},
{QString::fromUtf8("kurdish"),QString::fromUtf8("Kürtçe")},
{QString::fromUtf8("other"),QString::fromUtf8("Diğer")},
};
static const QMap<QString, QString> countryNames = {
{QString::fromUtf8("GB"),QString::fromUtf8("united kingdom|great britain|britain|england|ingiltere")},
{QString::fromUtf8("US"),QString::fromUtf8("united states|united states of america|america|abd")},
{QString::fromUtf8("TR"),QString::fromUtf8("turkey|turkiye")},
{QString::fromUtf8("DE"),QString::fromUtf8("germany|deutschland|almanya")},
{QString::fromUtf8("FR"),QString::fromUtf8("france|fransa")},
{QString::fromUtf8("IT"),QString::fromUtf8("italy|italia|italya")},
{QString::fromUtf8("ES"),QString::fromUtf8("spain|espana|ispanya")},
{QString::fromUtf8("PT"),QString::fromUtf8("portugal|portekiz")},
{QString::fromUtf8("BR"),QString::fromUtf8("brazil|brasil|brezilya")},
{QString::fromUtf8("SE"),QString::fromUtf8("sweden|sverige|isvec")},
{QString::fromUtf8("NO"),QString::fromUtf8("norway|norge|norvec")},
{QString::fromUtf8("DK"),QString::fromUtf8("denmark|danmark|danimarka")},
{QString::fromUtf8("FI"),QString::fromUtf8("finland|finlandiya")},
{QString::fromUtf8("NL"),QString::fromUtf8("netherlands|nederland|holland|hollanda")},
{QString::fromUtf8("BE"),QString::fromUtf8("belgium|belgique|belgien|belcika")},
{QString::fromUtf8("CH"),QString::fromUtf8("switzerland|schweiz|suisse|isvicre")},
{QString::fromUtf8("AT"),QString::fromUtf8("austria|osterreich|avusturya")},
{QString::fromUtf8("RU"),QString::fromUtf8("russia|rusya")},
{QString::fromUtf8("UA"),QString::fromUtf8("ukraine|ukrayna")},
{QString::fromUtf8("BY"),QString::fromUtf8("belarus|beyaz rusya")},
{QString::fromUtf8("MX"),QString::fromUtf8("mexico|meksika")},
{QString::fromUtf8("CO"),QString::fromUtf8("colombia|kolombiya")},
{QString::fromUtf8("CA"),QString::fromUtf8("canada|kanada")},
{QString::fromUtf8("AU"),QString::fromUtf8("australia|avustralya")},
{QString::fromUtf8("NZ"),QString::fromUtf8("new zealand|yeni zelanda")},
{QString::fromUtf8("PL"),QString::fromUtf8("poland|polska|polonya")},
{QString::fromUtf8("RO"),QString::fromUtf8("romania|romanya")},
{QString::fromUtf8("GR"),QString::fromUtf8("greece|ellada|yunanistan")},
{QString::fromUtf8("BG"),QString::fromUtf8("bulgaria|bulgaristan")},
{QString::fromUtf8("HU"),QString::fromUtf8("hungary|macaristan")},
{QString::fromUtf8("HR"),QString::fromUtf8("croatia|hirvatistan")},
{QString::fromUtf8("RS"),QString::fromUtf8("serbia|sirbistan")},
{QString::fromUtf8("BA"),QString::fromUtf8("bosnia|bosna")},
{QString::fromUtf8("AL"),QString::fromUtf8("albania|arnavutluk")},
{QString::fromUtf8("AZ"),QString::fromUtf8("azerbaijan|azerbaycan")},
{QString::fromUtf8("GE"),QString::fromUtf8("georgia|gurcistan")},
{QString::fromUtf8("AM"),QString::fromUtf8("armenia|ermenistan")},
{QString::fromUtf8("CZ"),QString::fromUtf8("czech republic|czechia|cekya")},
{QString::fromUtf8("SK"),QString::fromUtf8("slovakia|slovakya")},
{QString::fromUtf8("SI"),QString::fromUtf8("slovenia|slovenya")},
{QString::fromUtf8("MK"),QString::fromUtf8("macedonia|makedonya")},
{QString::fromUtf8("ME"),QString::fromUtf8("montenegro|karadag")},
{QString::fromUtf8("MD"),QString::fromUtf8("moldova")},
{QString::fromUtf8("IR"),QString::fromUtf8("iran")},
{QString::fromUtf8("IQ"),QString::fromUtf8("iraq|irak")},
{QString::fromUtf8("SA"),QString::fromUtf8("saudi arabia|suudi arabistan")},
{QString::fromUtf8("AE"),QString::fromUtf8("united arab emirates|birlesik arap emirlikleri")},
{QString::fromUtf8("QA"),QString::fromUtf8("qatar|katar")},
{QString::fromUtf8("EG"),QString::fromUtf8("egypt|misir")},
{QString::fromUtf8("IL"),QString::fromUtf8("israel|israil")},
{QString::fromUtf8("MA"),QString::fromUtf8("morocco|fas")},
{QString::fromUtf8("TN"),QString::fromUtf8("tunisia|tunus")},
{QString::fromUtf8("DZ"),QString::fromUtf8("algeria|cezayir")},
{QString::fromUtf8("IN"),QString::fromUtf8("india|hindistan")},
{QString::fromUtf8("PK"),QString::fromUtf8("pakistan")},
{QString::fromUtf8("BD"),QString::fromUtf8("bangladesh")},
{QString::fromUtf8("AF"),QString::fromUtf8("afghanistan|afganistan")},
{QString::fromUtf8("NP"),QString::fromUtf8("nepal")},
{QString::fromUtf8("LK"),QString::fromUtf8("sri lanka")},
{QString::fromUtf8("CN"),QString::fromUtf8("china|cin")},
{QString::fromUtf8("JP"),QString::fromUtf8("japan|japonya")},
{QString::fromUtf8("KR"),QString::fromUtf8("south korea|korea|guney kore")},
{QString::fromUtf8("ID"),QString::fromUtf8("indonesia|endonezya")},
{QString::fromUtf8("MY"),QString::fromUtf8("malaysia|malezya")},
{QString::fromUtf8("SG"),QString::fromUtf8("singapore|singapur")},
{QString::fromUtf8("TH"),QString::fromUtf8("thailand|tayland")},
{QString::fromUtf8("VN"),QString::fromUtf8("vietnam")},
{QString::fromUtf8("PH"),QString::fromUtf8("philippines|filipinler")},
{QString::fromUtf8("ZA"),QString::fromUtf8("south africa|guney afrika")},
{QString::fromUtf8("NG"),QString::fromUtf8("nigeria|nijerya")},
{QString::fromUtf8("KE"),QString::fromUtf8("kenya")},
{QString::fromUtf8("GH"),QString::fromUtf8("ghana")},
{QString::fromUtf8("AR"),QString::fromUtf8("argentina|arjantin")},
{QString::fromUtf8("CL"),QString::fromUtf8("chile|sili")},
{QString::fromUtf8("PE"),QString::fromUtf8("peru")},
{QString::fromUtf8("VE"),QString::fromUtf8("venezuela|venezüella")},
{QString::fromUtf8("EC"),QString::fromUtf8("ecuador|ekvador")},
{QString::fromUtf8("UY"),QString::fromUtf8("uruguay")},
{QString::fromUtf8("PY"),QString::fromUtf8("paraguay")},
{QString::fromUtf8("BO"),QString::fromUtf8("bolivia|bolivya")},
{QString::fromUtf8("CR"),QString::fromUtf8("costa rica")},
{QString::fromUtf8("PA"),QString::fromUtf8("panama")},
{QString::fromUtf8("DO"),QString::fromUtf8("dominican republic|dominik cumhuriyeti")},
{QString::fromUtf8("IE"),QString::fromUtf8("ireland|irlanda")},
{QString::fromUtf8("IS"),QString::fromUtf8("iceland|izlanda")},
{QString::fromUtf8("EE"),QString::fromUtf8("estonia|estonya")},
{QString::fromUtf8("LV"),QString::fromUtf8("latvia|letonya")},
{QString::fromUtf8("LT"),QString::fromUtf8("lithuania|litvanya")},
{QString::fromUtf8("CY"),QString::fromUtf8("cyprus|kibris")},
{QString::fromUtf8("MT"),QString::fromUtf8("malta")},
{QString::fromUtf8("UZ"),QString::fromUtf8("uzbekistan|ozbekistan")},
{QString::fromUtf8("KZ"),QString::fromUtf8("kazakhstan|kazakistan")},
{QString::fromUtf8("KG"),QString::fromUtf8("kyrgyzstan|kirgizistan")},
{QString::fromUtf8("TJ"),QString::fromUtf8("tajikistan|tacikistan")},
{QString::fromUtf8("TM"),QString::fromUtf8("turkmenistan")},
};
static const QMap<QString, QString> countryAliases = {
{QString::fromUtf8("UK"),QString::fromUtf8("GB")},
{QString::fromUtf8("USA"),QString::fromUtf8("US")},
{QString::fromUtf8("TUR"),QString::fromUtf8("TR")},
{QString::fromUtf8("GER"),QString::fromUtf8("DE")},
{QString::fromUtf8("FRA"),QString::fromUtf8("FR")},
{QString::fromUtf8("ITA"),QString::fromUtf8("IT")},
{QString::fromUtf8("ESP"),QString::fromUtf8("ES")},
{QString::fromUtf8("POR"),QString::fromUtf8("PT")},
{QString::fromUtf8("GRE"),QString::fromUtf8("GR")},
{QString::fromUtf8("NED"),QString::fromUtf8("NL")},
{QString::fromUtf8("RUS"),QString::fromUtf8("RU")},
{QString::fromUtf8("BRA"),QString::fromUtf8("BR")},
{QString::fromUtf8("COL"),QString::fromUtf8("CO")},
{QString::fromUtf8("KSA"),QString::fromUtf8("SA")},
{QString::fromUtf8("UAE"),QString::fromUtf8("AE")},
};
static const QStringList countryOrder = {QStringLiteral("tr"),QStringLiteral("de"),QStringLiteral("fr"),QStringLiteral("gb"),QStringLiteral("us"),QStringLiteral("it"),QStringLiteral("es"),QStringLiteral("pt"),QStringLiteral("bg"),QStringLiteral("gr"),QStringLiteral("se"),QStringLiteral("dk"),QStringLiteral("ru"),QStringLiteral("br"),QStringLiteral("latam"),QStringLiteral("arabic"),QStringLiteral("kurdish"),QStringLiteral("other")};
static const QStringList isoCountries = {QStringLiteral("AD"),QStringLiteral("AE"),QStringLiteral("AF"),QStringLiteral("AG"),QStringLiteral("AI"),QStringLiteral("AL"),QStringLiteral("AM"),QStringLiteral("AO"),QStringLiteral("AQ"),QStringLiteral("AR"),QStringLiteral("AS"),QStringLiteral("AT"),QStringLiteral("AU"),QStringLiteral("AW"),QStringLiteral("AX"),QStringLiteral("AZ"),QStringLiteral("BA"),QStringLiteral("BB"),QStringLiteral("BD"),QStringLiteral("BE"),QStringLiteral("BF"),QStringLiteral("BG"),QStringLiteral("BH"),QStringLiteral("BI"),QStringLiteral("BJ"),QStringLiteral("BL"),QStringLiteral("BM"),QStringLiteral("BN"),QStringLiteral("BO"),QStringLiteral("BQ"),QStringLiteral("BR"),QStringLiteral("BS"),QStringLiteral("BT"),QStringLiteral("BV"),QStringLiteral("BW"),QStringLiteral("BY"),QStringLiteral("BZ"),QStringLiteral("CA"),QStringLiteral("CC"),QStringLiteral("CD"),QStringLiteral("CF"),QStringLiteral("CG"),QStringLiteral("CH"),QStringLiteral("CI"),QStringLiteral("CK"),QStringLiteral("CL"),QStringLiteral("CM"),QStringLiteral("CN"),QStringLiteral("CO"),QStringLiteral("CR"),QStringLiteral("CU"),QStringLiteral("CV"),QStringLiteral("CW"),QStringLiteral("CX"),QStringLiteral("CY"),QStringLiteral("CZ"),QStringLiteral("DE"),QStringLiteral("DJ"),QStringLiteral("DK"),QStringLiteral("DM"),QStringLiteral("DO"),QStringLiteral("DZ"),QStringLiteral("EC"),QStringLiteral("EE"),QStringLiteral("EG"),QStringLiteral("EH"),QStringLiteral("ER"),QStringLiteral("ES"),QStringLiteral("ET"),QStringLiteral("FI"),QStringLiteral("FJ"),QStringLiteral("FK"),QStringLiteral("FM"),QStringLiteral("FO"),QStringLiteral("FR"),QStringLiteral("GA"),QStringLiteral("GB"),QStringLiteral("GD"),QStringLiteral("GE"),QStringLiteral("GF"),QStringLiteral("GG"),QStringLiteral("GH"),QStringLiteral("GI"),QStringLiteral("GL"),QStringLiteral("GM"),QStringLiteral("GN"),QStringLiteral("GP"),QStringLiteral("GQ"),QStringLiteral("GR"),QStringLiteral("GS"),QStringLiteral("GT"),QStringLiteral("GU"),QStringLiteral("GW"),QStringLiteral("GY"),QStringLiteral("HK"),QStringLiteral("HM"),QStringLiteral("HN"),QStringLiteral("HR"),QStringLiteral("HT"),QStringLiteral("HU"),QStringLiteral("ID"),QStringLiteral("IE"),QStringLiteral("IL"),QStringLiteral("IM"),QStringLiteral("IN"),QStringLiteral("IO"),QStringLiteral("IQ"),QStringLiteral("IR"),QStringLiteral("IS"),QStringLiteral("IT"),QStringLiteral("JE"),QStringLiteral("JM"),QStringLiteral("JO"),QStringLiteral("JP"),QStringLiteral("KE"),QStringLiteral("KG"),QStringLiteral("KH"),QStringLiteral("KI"),QStringLiteral("KM"),QStringLiteral("KN"),QStringLiteral("KP"),QStringLiteral("KR"),QStringLiteral("KW"),QStringLiteral("KY"),QStringLiteral("KZ"),QStringLiteral("LA"),QStringLiteral("LB"),QStringLiteral("LC"),QStringLiteral("LI"),QStringLiteral("LK"),QStringLiteral("LR"),QStringLiteral("LS"),QStringLiteral("LT"),QStringLiteral("LU"),QStringLiteral("LV"),QStringLiteral("LY"),QStringLiteral("MA"),QStringLiteral("MC"),QStringLiteral("MD"),QStringLiteral("ME"),QStringLiteral("MF"),QStringLiteral("MG"),QStringLiteral("MH"),QStringLiteral("MK"),QStringLiteral("ML"),QStringLiteral("MM"),QStringLiteral("MN"),QStringLiteral("MO"),QStringLiteral("MP"),QStringLiteral("MQ"),QStringLiteral("MR"),QStringLiteral("MS"),QStringLiteral("MT"),QStringLiteral("MU"),QStringLiteral("MV"),QStringLiteral("MW"),QStringLiteral("MX"),QStringLiteral("MY"),QStringLiteral("MZ"),QStringLiteral("NA"),QStringLiteral("NC"),QStringLiteral("NE"),QStringLiteral("NF"),QStringLiteral("NG"),QStringLiteral("NI"),QStringLiteral("NL"),QStringLiteral("NO"),QStringLiteral("NP"),QStringLiteral("NR"),QStringLiteral("NU"),QStringLiteral("NZ"),QStringLiteral("OM"),QStringLiteral("PA"),QStringLiteral("PE"),QStringLiteral("PF"),QStringLiteral("PG"),QStringLiteral("PH"),QStringLiteral("PK"),QStringLiteral("PL"),QStringLiteral("PM"),QStringLiteral("PN"),QStringLiteral("PR"),QStringLiteral("PS"),QStringLiteral("PT"),QStringLiteral("PW"),QStringLiteral("PY"),QStringLiteral("QA"),QStringLiteral("RE"),QStringLiteral("RO"),QStringLiteral("RS"),QStringLiteral("RU"),QStringLiteral("RW"),QStringLiteral("SA"),QStringLiteral("SB"),QStringLiteral("SC"),QStringLiteral("SD"),QStringLiteral("SE"),QStringLiteral("SG"),QStringLiteral("SH"),QStringLiteral("SI"),QStringLiteral("SJ"),QStringLiteral("SK"),QStringLiteral("SL"),QStringLiteral("SM"),QStringLiteral("SN"),QStringLiteral("SO"),QStringLiteral("SR"),QStringLiteral("SS"),QStringLiteral("ST"),QStringLiteral("SV"),QStringLiteral("SX"),QStringLiteral("SY"),QStringLiteral("SZ"),QStringLiteral("TC"),QStringLiteral("TD"),QStringLiteral("TF"),QStringLiteral("TG"),QStringLiteral("TH"),QStringLiteral("TJ"),QStringLiteral("TK"),QStringLiteral("TL"),QStringLiteral("TM"),QStringLiteral("TN"),QStringLiteral("TO"),QStringLiteral("TR"),QStringLiteral("TT"),QStringLiteral("TV"),QStringLiteral("TW"),QStringLiteral("TZ"),QStringLiteral("UA"),QStringLiteral("UG"),QStringLiteral("UM"),QStringLiteral("US"),QStringLiteral("UY"),QStringLiteral("UZ"),QStringLiteral("VA"),QStringLiteral("VC"),QStringLiteral("VE"),QStringLiteral("VG"),QStringLiteral("VI"),QStringLiteral("VN"),QStringLiteral("VU"),QStringLiteral("WF"),QStringLiteral("WS"),QStringLiteral("YE"),QStringLiteral("YT"),QStringLiteral("ZA"),QStringLiteral("ZM"),QStringLiteral("ZW")};

const QSet<QString> extensions{"mp4","mkv","avi","m3u8","ts"};
const QStringList liveCategories{"national","news","sports","kids","documentary","music","local","themed","radio"};
const QStringList liveTitles{QString::fromUtf8("Ulusal"),QString::fromUtf8("Haber"),QString::fromUtf8("Spor"),QString::fromUtf8("Çocuk"),QString::fromUtf8("Belgesel"),QString::fromUtf8("Müzik"),QString::fromUtf8("Yerel"),QStringLiteral("7/24"),QString::fromUtf8("Radyo")};
const QRegularExpression &rx(const QString &pattern) {thread_local QHash<QString,QRegularExpression> cache;if(cache.size()>256)cache.clear();auto it=cache.find(pattern);if(it==cache.end())it=cache.insert(pattern,QRegularExpression(pattern,QRegularExpression::UseUnicodePropertiesOption));return it.value();}
QString replace(QString text, const QString &pattern, const QString &replacement={}) {return text.replace(rx(pattern),replacement);}
bool matches(const QString &text,const QString &pattern) {return rx(pattern).match(text).hasMatch();}
QString label(QString s){return replace(fold(s),"^tr\\s*[|:]\\s*","").trimmed();}
QSet<QString> movieCategories() {
    static const QSet<QString> values=[] {QSet<QString> s;for(const auto &v:QString::fromUtf8("Vizyondaki Filmler|Yüksek Puanlı Filmler|Yerli Filmler|Yeşilçam Filmleri|Kemal Sunal Filmleri|Film Serileri / Box Setler|Aksiyon - Macera Filmleri|Macera|Komedi|Dram - Romantik|Romantik|Korku - Gerilim|Suç / Polisiye|Bilim Kurgu - Fantastik Filmler|Fantastik|Tarih / Savaş|Gerçek Hikâye / Biyografi|Vahşi Batı / Western|Müzikal|Belgesel|Aile|Animasyon / Çizgi Film|Anime|Aksiyon (Yabancı)|Aksiyon (Yerli)|Amazon|Animasyon|Apple TV+|Bilim Kurgu|Disney+|Dram (Yabancı)|Dram (Yerli)|Filmler|Gerilim (Yabancı)|HBO Max|Komedi (Yabancı)|Komedi (Yerli)|Korku (Yabancı)|Korku (Yerli)|MUBI FILMLER|Müzik|Netflix|Savaş|Seri Filmler|Sinema|Suç|Tabii").split('|'))s.insert(label(v));return s;}();return values;
}
QString station(const QString &s) {auto v=search(s);return stationNames.value(v,v);}
QString countryCode(QString s) {s=s.toUpper();return countryAliases.value(s,isoCountries.contains(s)?s:QString());}
struct Prefix{QString country,quality,rest;};
Prefix prefix(const QString &s) {
    for(const auto &pattern:QStringList{"(?i)^([a-z]{2,3}?)\\s*(fhd|fullhd|hd|sd|uhd|4k|1080[pi]|720p)(?:\\s*[•·|:\\-]+\\s*|\\s+)","(?i)^([a-z]{2,3})\\s*[•·|:\\-]+\\s*"}) {
        auto m=rx(pattern).match(s);auto c=countryCode(m.captured(1));if(m.hasMatch()&&!c.isEmpty())return {c,m.lastCapturedIndex()>1?m.captured(2):QString(),s.mid(m.capturedLength())};
    }return {{},{},s};
}
QString groupCountry(const QString &s) {
    auto p=prefix(s);if(!p.country.isEmpty())return p.country;
    auto m=QRegularExpression("(?i)^([a-z]{2,3})(?:\\s|$)").match(s);if(m.hasMatch()){auto c=countryCode(m.captured(1));if(!c.isEmpty())return c;}
    auto normalized=replace(fold(s),"[^\\p{L}\\p{N}\\s]"," ").simplified();
    for(auto i=countryNames.begin();i!=countryNames.end();++i)for(const auto &n:i.value().split('|'))if(normalized==n||normalized.startsWith(n+' '))return i.key();
    return {};
}
const QString technical=QStringLiteral("(?i)\\b(?:full[\\s_-]*hd|fhd|1080[pi]|720[pi]?|480[pi]?|576[pi]?|2160[pi]?|4k|uhd|hd|sd|raw|hevc|h[.\\s_-]?26[45]|x26[45]|avc|mpeg[\\s_-]*ts|m3u8|hls|(?:25|30|50|60|100|120)\\s*(?:fps|hz)|\\d+(?:[.,]\\d+)?\\s*(?:kbps|mbps|mbit))\\b");
const QString event=QString::fromUtf8("(?i)\\b(?:ma[çc]ta(?:\\s+akt[iıİ]f)?|sadece\\s+(?:[iıİ]st(?:anbul)?[.\\s]*)?ma[çc](?:lar[ıi])?|ma[çc](?:lar)?\\s*(?:zaman[ıi]|saat[iıİ]nde|g[üu]n[üu]|akt[iıİ]f)|yay[ıi]n\\s*(?:zaman[ıi]|s[ıi]ras[ıi]nda)\\s*(?:akt[iıİ]f|a[çc][ıi]k)?|event[\\s_-]*only|live[\\s_-]*events?[\\s_-]*only|only\\s+(?:during\\s+)?events?|only\\s+matches|matches\\s+only)\\b");
const QString low=QString::fromUtf8("(?i)\\b(?:kota\\s*dostu|low(?:\\s+(?:bitrate|bandwidth))?|d[üu][şs][üu]k(?:\\s+(?:bitrate|bant))?)\\b");
QString smallcaps(QString s){static const QString caps=QString::fromUtf8("ꜰʜᴅᴇᴠᴄʀᴀᴡꜱᴘᴛɪɴᴏᴜʟᴋᴍʙɢᴊ"),plain="FHDEVCRAWSPTINOULKMBGJ";s=s.normalized(QString::NormalizationForm_KC);for(qsizetype i=0;i<caps.size();++i)s.replace(caps[i],plain[i]);return s;}
struct LiveAnalysis {QString name,group,country,category;double position=1000;std::array<int,5> score;};
LiveAnalysis describe(const QVariantMap &item) {
    auto original=replace(smallcaps(item.value("sourceTitle",item.value("title")).toString()),"(?i)<br\\s*/?\\s*>|[\\x00-\\x1f\\x7f-\\x9f]"," ").trimmed();
    original=replace(original,"(?i)^\\s*\\[\\s*fubotv\\s*\\]\\s*","");
    auto p=prefix(original);auto group=fold(smallcaps(item.value("categoryName").toString()));auto fromGroup=groupCountry(group);auto country=p.country.isEmpty()?fromGroup:p.country;auto text=fold(p.quality+' '+p.rest);
    bool hevc=matches(text,"\\b(?:hevc|h[.\\s_-]?265|x265)\\b"),raw=matches(text,"\\braw\\b");
    int quality=matches(text,"\\b(?:4k|uhd|2160[pi]?)\\b")?5:matches(text,"\\b(?:sd|480[pi]?|576[pi]?)\\b")?4:matches(text,"\\b720[pi]?\\b")?1:matches(text,"\\b(?:fhd|full[\\s_-]*hd|1080[pi])\\b")?0:matches(text,"\\bhd\\b")?1:raw?2:3;
    auto name=p.rest;auto notes=QRegularExpression("\\[([^\\]]*)\\]|\\(([^)]*)\\)|\\{([^}]*)\\}").globalMatch(name);QList<QRegularExpressionMatch> captured;while(notes.hasNext())captured.append(notes.next());
    for(auto i=captured.crbegin();i!=captured.crend();++i) {QString note;for(int j=1;j<=3;j++)if(!i->captured(j).isNull())note=i->captured(j);auto remaining=replace(replace(replace(fold(note),technical," "),"\\b7\\s*[/x]\\s*24(?:\\s+canli)?\\b"," "),"[\\s.,:;_\\-/]+","");if(remaining.isEmpty()||matches(note,event)||matches(note,low)||matches(note,"(?i)^(?:fubotv|fibra|sat|orange|live\\s*events?)$"))name.replace(i->capturedStart(),i->capturedLength()," ");}
    name=replace(name,QString::fromUtf8("(?i)^VIP\\s+(?=be[iıİ]n\\s*sports?|s\\s*sport|exxen\\b)"),"");
    const bool branded4k=matches(name,"(?i)^\\s*(trt|bein\\s*sports?)\\s*4k(?:\\s|$)");
    name=replace(replace(replace(name,event," "),low," "),technical," ");name=replace(name,QString::fromUtf8("(?i)\\b7\\s*[/x]\\s*24(?:\\s+canl[ıi])?\\b|\\b(?:canl[ıi]\\s*yay[ıi]n|canl[ıi])\\s*$")," ");name=replace(name,"^[\\s•·|:\\-]+|[\\s•·|:\\-]+$","").simplified();
    name=replace(name,QString::fromUtf8("(?i)^be[iıİ]n\\s*sports?\\s*(?=\\d|MAX\\b|PLUS\\b|$)"),"BEIN Sport ");name=replace(name,"(?i)^s\\s*sport\\s*(?=\\d|MAX\\b|PLUS\\b|$)","S Sport ");
    static const QHash<QString,QString> brands{{"aspor","A Spor"},{"trtspor","TRT Spor"},{"trt1","TRT 1"},{"kanald","Kanal D"},{"startv","Star TV"},{"beyaztv","Beyaz TV"},{"tv8","TV8"},{"tv85","TV8.5"},{"halktv","Halk TV"},{"ahaber","A Haber"},{"atv","ATV"},{"360tv","360"},{"360","360"}};
    name=brands.value(search(name),name).trimmed();auto exxen=QRegularExpression("(?i)^exxen\\s*(?:sport\\s*)?(\\d+)").match(name);if(exxen.hasMatch()&&matches(group,"\\b(?:spor|sport|sports)\\b"))name="EXXEN Sport "+exxen.captured(1);
    if(branded4k&&(search(name)=="trt"||search(name)=="beinsport"))name=search(name)=="trt"?"TRT 4K":"BEIN Sport 4K";
    auto normalized=replace(replace(fold(name),QString::fromUtf8("[’'`\"]"),""),"[^\\p{L}\\p{N}+\\s]"," ").simplified();
    QStringList languages;static const QMap<QString,QString> languageWords{{"ar","arabic|arapca"},{"de","german|deutsch|almanca"},{"en","english|ingilizce|eng"},{"es","spanish|espanol|ispanyolca"},{"fr","french|francais|fransizca"},{"it","italian|italiano|italyanca"},{"ku","kurdish|kurtce"},{"pt","portuguese|portugues|portekizce"},{"ru","russian|rusca"},{"tr","turkish|turkce"}};
    for(auto i=languageWords.begin();i!=languageWords.end();++i)if(matches(fold(name)+' '+group,"\\b(?:"+i.value()+")\\b"))languages.append(i.key());
    auto conflict=!p.country.isEmpty()&&!fromGroup.isEmpty()&&p.country!=fromGroup?"!"+fromGroup:QString();
    LiveAnalysis out;out.name=name;out.group=(country.isEmpty()?"unknown:"+group:country)+conflict+'|'+languages.join(',')+'|'+normalized;out.score={hevc?1:0,quality,matches(text,event)?1:0,matches(text,low)?1:0,raw?1:0};
    out.country=country=="CO"?"latam":country.toLower();if(!countryOrder.contains(out.country))out.country="other";
    if(country.isEmpty()){if(matches(group,"^(?:arabic|arabia|middle east)(?:\\W|$)"))out.country="arabic";else if(matches(group,"^(?:kurdish|ku)(?:\\W|$)"))out.country="kurdish";else if(matches(group,"^(?:latin america|latam)(?:\\W|$)"))out.country="latam";else if(matches(group,"^(?:turkish|turkce|turkiye|turkey)(?:\\W|$)"))out.country="tr";}
    auto s=station(name);static const QSet<QString> national{"trt1","kanald","atv","showtv","now","startv","kanal7","tv8","beyaztv","cnbce","diyanettv","a2","teve2","tv85","trt2","360","tlc","dmax","trt4k"};static const QSet<QString> news{"trthaber","cnnturk","ntv","ahaber","haberturk","sozcutv","halktv","tele1","tv100","24","tgrthaber","apara","ekoturk","bloomberght","ulusal1","ulusalkanal"};
    auto all=group+' '+fold(name);out.category="national";
    if(national.contains(s)){}else if(matches(group,"radyo|radio"))out.category="radio";else if(matches(group,"muzik|music"))out.category="music";else if(matches(group,"yoresel|yerel|local|regional"))out.category="local";else if(matches(group,"7\\s*[/x]\\s*24|sinema|cinema|yerli dizi|yabanci dizi|ambiyans"))out.category="themed";else if(matches(all,"belgesel|documenta(?:ry|ire)|nature|discovery|nat geo"))out.category="documentary";else if(matches(all,"cocuk|kids?|child|cartoon|nick(?:elodeon)?|minika|baby"))out.category="kids";else if(news.contains(s)||matches(all,"haber|news|cnn|bbc world|bulten"))out.category="news";else if(matches(all,"spor|sport|futbol|football|bein|dazn|nfl|nba|laliga|liga de campeones|eurosport"))out.category="sports";
    static const QHash<QString,double> positions=[] {QHash<QString,double> p;for(auto i=referencePositions.begin();i!=referencePositions.end();++i)p[station(i.key())]=i.value();return p;}();
    static const QHash<QString,QString> aliasKeys=[] {QHash<QString,QString> a;for(auto i=aliases.begin();i!=aliases.end();++i)a[station(i.key())]=station(i.value());return a;}();
    const auto alias=aliasKeys.value(s,s);if(positions.contains(alias))out.position=positions.value(alias);else {static const QHash<QString,double> fallback{{"national",48.9},{"news",69.9},{"sports",94.9},{"documentary",117.9},{"kids",136.9},{"music",199.9},{"local",299.9}};out.position=fallback.value(out.category,1000);if(out.category=="sports"){QStringList bein{"beinsport1","beinsport2","beinsport3","beinsport4","beinsport5","beinsportmax1","beinsportmax2","beinsport4k"};if(bein.contains(s))out.position=76+(bein.indexOf(s)+1)/100.0;else if(matches(s,"^beinsport(?:max|plus)?[0-9]+$"))out.position=76.9;else if(matches(s,"^tivibusport?([0-9]+|4k)?$"))out.position=84+(s.endsWith("4k")?.9:QRegularExpression("([0-9]+)$").match(s).captured(1).toInt()/100.0);else if(matches(s,"^ssportplus[0-9]+$"))out.position=88.5;else if(matches(s,"^exxen(?:sports?)?[0-9]+$"))out.position=89.5;else if(matches(s,"^beinconne?ct|^beinconnet"))out.position=91.5;}if(matches(group,"dini|religio|diyanet"))out.position=247.5;}
    return out;
}
quint32 rank(QString s){quint32 v=0x811c9dc5;for(auto c:s)v=(v^c.unicode())*16777619;v^=v>>16;v*=0x85ebca6b;v^=v>>13;return v;}
QVariantList ranked(QVariantList rows,qint64 now) {auto day=QDateTime::fromMSecsSinceEpoch(now,QTimeZone("Europe/Istanbul")).date().toString(Qt::ISODate);std::stable_sort(rows.begin(),rows.end(),[&](const QVariant&a,const QVariant&b){auto ka=key(a.toMap()),kb=key(b.toMap());auto ra=rank(day+QChar(0)+ka),rb=rank(day+QChar(0)+kb);return ra==rb?ka<kb:ra<rb;});return rows;}
QVariantList covered(QVariantList rows,int limit=18){std::stable_partition(rows.begin(),rows.end(),[](const QVariant &v){return !v.toMap().value("artworkURL").toString().isEmpty();});return rows.mid(0,limit);}
}
namespace Catalog {
QString clean(const QJsonValue &v,int maximum){if(!v.isString()||v.toString().size()>maximum)return {};return replace(v.toString(),"[\\x00-\\x1f\\x7f-\\x9f]"," ").simplified();}
QString fold(QString s) {s=s.normalized(QString::NormalizationForm_KD).toLower().replace(QChar(0x131),'i');return replace(s,"\\p{M}","");}
QString search(QString s) {static const QString caps=QString::fromUtf8("ꜰʜᴅᴇᴠᴄʀᴀᴡꜱᴘᴛɪɴᴏᴜʟᴋᴍʙɢᴊ"),plain="FHDEVCRAWSPTINOULKMBGJ";for(qsizetype i=0;i<caps.size();++i)s.replace(caps[i],plain[i]);return replace(fold(s),"[^\\p{L}\\p{N}]","");}
QString id(const QJsonValue &v){QString s;if(v.isString())s=v.toString();else if(v.isDouble()){double d=v.toDouble();if(d>=1&&d<=999999999999999.0&&std::floor(d)==d)s=QString::number(qint64(d));}return matches(s,"^[1-9][0-9]{0,14}$")?s:QString();}
QString artwork(const QJsonValue &v){if(!v.isString())return {};auto s=v.toString();QUrl u(s,QUrl::StrictMode);return s.size()<=2048&&u.isValid()&&u.scheme()=="https"&&!u.host().isEmpty()&&u.userInfo().isEmpty()&&!u.hasQuery()&&!u.hasFragment()&&!s.contains('\\')?u.toString(QUrl::FullyEncoded):QString();}
QString key(const QVariantMap &v){return v.value("kind").toString()+':'+v.value("seriesID").toString()+':'+v.value("id").toString();}
int releaseYear(const QJsonObject &r,const QString &title) {QSet<int> years;for(const auto &field:QStringList{"year","release_year","releaseYear","releaseDate","release_date"}){auto v=r.value(field);if(v.isNull()||v.isUndefined()||(v.isString()&&v.toString().trimmed().isEmpty()))continue;int y=0;auto s=v.toString().trimmed();if(field=="releaseDate"||field=="release_date"){if(matches(s,"^(?:19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}(?:T.*)?$")&&QDate::fromString(s.left(10),Qt::ISODate).isValid()&&(s.size()==10||QDateTime::fromString(s,Qt::ISODateWithMs).isValid()))y=s.left(4).toInt();}else if(v.isDouble()&&std::floor(v.toDouble())==v.toDouble())y=v.toInt();else if(matches(s,"^(?:19|20)[0-9]{2}$"))y=s.toInt();if(y<1900||y>2099)return 0;years.insert(y);}if(!years.isEmpty())return years.size()==1?*years.begin():0;auto matches=QRegularExpression("\\(((?:19|20)[0-9]{2})\\)|\\[((?:19|20)[0-9]{2})\\]").globalMatch(title.trimmed());int end=0;while(matches.hasNext()){auto m=matches.next();years.insert((m.captured(1).isEmpty()?m.captured(2):m.captured(1)).toInt());end=m.capturedEnd();}return years.size()==1&&end==title.trimmed().size()?*years.begin():0;}
QVariantList parse(const QString &kind,const QJsonArray &rows,const QJsonArray &groups,const QString &scope){if(!QStringList{"live","movie","series"}.contains(kind)||rows.size()>50000||groups.size()>50000)throw std::runtime_error("catalog limit");QHash<QString,QString> categories;for(const auto &v:groups){auto r=v.toObject();auto i=id(r["category_id"]),name=clean(r["category_name"],256);if(i.isEmpty()||name.isEmpty())continue;if(categories.contains(i)&&categories[i]!=name)throw std::runtime_error("conflicting category");categories[i]=name;}QSet<QString> seen;QVariantList output;
for(const auto &v:rows){auto r=v.toObject();auto i=id(r[kind=="series"?"series_id":"stream_id"]),title=clean(r["name"]),c=id(r["category_id"]),category=categories.value(c);if(i.isEmpty()||title.isEmpty()||seen.contains(i)||matches(title.toLower(),"^(?:data:image/|/9j/|ivborw0kggo|r0lgod)")||(title.size()>=160&&matches(title,"^[A-Za-z0-9+/=\\s]+$")))continue;auto ext=r["container_extension"].toString().toLower();if(!extensions.contains(ext))ext=kind=="live"?(r["container_extension"].isUndefined()||r["container_extension"].isNull()||r["container_extension"].toString().isEmpty()?"ts":"m3u8"):QString();if(kind=="movie"&&(category.isEmpty()||!movieCategories().contains(label(category))||ext.isEmpty()))continue;output.append(QVariantMap{{"id",i},{"kind",kind},{"title",title},{"sourceTitle",title},{"categoryID",c},{"categoryName",category},{"artworkURL",artwork(r["stream_icon"].isNull()||r["stream_icon"].isUndefined()?r["cover"]:r["stream_icon"])},{"extension",ext},{"scope",scope},{"seriesID",QString()},{"season",0},{"episode",0},{"description",clean(r["plot"],8192)},{"releaseYear",kind=="live"?0:releaseYear(r,title)}});seen.insert(i);}for(auto &v:output){auto i=v.toMap();i["_search"]=search(i["title"].toString()+' '+i["sourceTitle"].toString()+' '+i["categoryName"].toString());v=i;}return output;}
QVariantList curateLive(const QVariantList &items,const QSet<QString> &excluded,QHash<QString,QString> *mapping){QMap<QString,QList<QPair<QVariantMap,LiveAnalysis>>> groups;for(const auto &v:items){auto item=v.toMap();if(excluded.contains(item["id"].toString()))continue;auto a=describe(item);if(a.name.isEmpty()||search(a.name)=="trt4k"||search(a.name).contains("sifirpanelbilgilendirme"))continue;groups[a.group].append({item,a});}QVariantList chosen;if(mapping)mapping->clear();for(auto entries:groups){std::sort(entries.begin(),entries.end(),[](const auto&a,const auto&b){return a.second.score==b.second.score?a.first["id"].toString().toLongLong()<b.first["id"].toString().toLongLong():a.second.score<b.second.score;});auto selected=entries.first().first;auto a=entries.first().second;selected["title"]=a.name;selected["countryID"]=a.country;selected["liveCategoryID"]=a.category;selected["lineupPosition"]=a.position;selected["_search"]=search(a.name+' '+selected["sourceTitle"].toString()+' '+selected["categoryName"].toString());chosen.append(selected);if(mapping)for(const auto &entry:entries)(*mapping)[entry.first["id"].toString()]=selected["id"].toString();}QCollator collator(QLocale("tr_TR"));collator.setNumericMode(true);collator.setCaseSensitivity(Qt::CaseInsensitive);std::stable_sort(chosen.begin(),chosen.end(),[&](const QVariant&a,const QVariant&b){auto x=a.toMap(),y=b.toMap();bool tr=x["countryID"]=="tr",other=y["countryID"]=="tr";if(tr!=other)return tr;if(!tr)return false;if(x["lineupPosition"]!=y["lineupPosition"])return x["lineupPosition"].toDouble()<y["lineupPosition"].toDouble();int c=collator.compare(x["title"].toString(),y["title"].toString());return c==0?x["id"].toString().toLongLong()<y["id"].toString().toLongLong():c<0;});return chosen;}
QVariantList filter(const QVariantList &items,const QString &q,const QString &category,const QString &country){auto needle=search(q);QVariantList result;for(const auto &v:items){auto i=v.toMap();if(!category.isEmpty()&&category!="all"&&i.value(i.value("kind")=="live"?"liveCategoryID":"categoryID").toString()!=category)continue;if(!country.isEmpty()&&country!="all"&&i.value("countryID").toString()!=country)continue;if(!needle.isEmpty()){auto haystack=i.value("_search").toString();if(haystack.isEmpty())haystack=search(i.value("title").toString()+' '+i.value("sourceTitle").toString()+' '+i.value("categoryName").toString());if(!haystack.contains(needle))continue;}result.append(i);}return result;}
QVariantMap series(const QJsonObject &raw,const QVariantMap &parent){if(parent.value("kind")!="series"||!raw["episodes"].isObject())throw std::runtime_error("invalid series");QVariantList rows;QSet<QString> seen;int count=0;for(const auto &bucket:raw["episodes"].toObject()){if(!bucket.isArray()||bucket.toArray().size()>5000||(count+=bucket.toArray().size())>5000)throw std::runtime_error("series limit");for(const auto &v:bucket.toArray()){auto r=v.toObject();auto i=id(r["id"]),ext=r["container_extension"].toString().toLower();auto positive=[](const QJsonValue &v){return v.isDouble()?v.toInt():v.toString().toInt();};int season=positive(r["season"]),episode=positive(r["episode_num"]);if(i.isEmpty()||seen.contains(i)||!extensions.contains(ext)||season<1||season>999||episode<1||episode>9999)continue;auto info=r["info"].toObject();auto row=parent;auto title=clean(r["title"]);row["id"]=i;row["kind"]="episode";row["seriesID"]=parent.value("id");row["season"]=season;row["episode"]=episode;row["title"]=title.isEmpty()?QString::fromUtf8("%1. Bölüm").arg(episode):title;row["sourceTitle"]=row["title"];row["extension"]=ext;row["description"]=clean(info["plot"],8192);auto art=artwork(info["movie_image"]);if(!art.isEmpty())row["artworkURL"]=art;rows.append(row);seen.insert(i);}}
std::sort(rows.begin(),rows.end(),[](const QVariant&a,const QVariant&b){auto x=a.toMap(),y=b.toMap();return std::make_tuple(x["season"].toInt(),x["episode"].toInt(),x["id"].toString().toLongLong())<std::make_tuple(y["season"].toInt(),y["episode"].toInt(),y["id"].toString().toLongLong());});QVariantList seasons;int previous=-1;for(const auto &v:rows){auto row=v.toMap();int number=row["season"].toInt();if(number!=previous){seasons.append(QVariantMap{{"number",number},{"episodes",QVariantList{}}});previous=number;}auto s=seasons.last().toMap();auto episodes=s["episodes"].toList();episodes.append(row);s["episodes"]=episodes;seasons.last()=s;}return {{"series",parent},{"seasons",seasons}};}
QVariantList episodes(const QVariantMap &d){QVariantList result;for(const auto&s:d.value("seasons").toList())result+=s.toMap().value("episodes").toList();return result;}
QVariantList epg(const QJsonObject &raw){auto rows=raw["epg_listings"].toArray();if(rows.size()>24)throw std::runtime_error("epg limit");QVariantList result;for(const auto&v:rows){auto r=v.toObject();auto encoded=r["title"].toString();if(encoded.size()>1024)continue;auto bytes=QByteArray::fromBase64Encoding(encoded.toLatin1(),QByteArray::AbortOnBase64DecodingErrors);if(!bytes)continue;auto title=clean(QString::fromUtf8(bytes.decoded));auto start=r["start_timestamp"].toVariant().toLongLong(),end=(r.contains("stop_timestamp")?r["stop_timestamp"]:r["end_timestamp"]).toVariant().toLongLong();if(title.isEmpty()||start<946684800||end>4102444800LL||end<=start||end-start>86400)continue;result.append(QVariantMap{{"title",title},{"startsAt",start*1000},{"endsAt",end*1000}});}std::sort(result.begin(),result.end(),[](const QVariant&a,const QVariant&b){return a.toMap()["startsAt"].toLongLong()<b.toMap()["startsAt"].toLongLong();});return result;}
QVariantList categories(const QVariantList &rows,bool live){QMap<QString,QString> names;for(const auto&v:rows){auto i=v.toMap();auto id=i.value(live?"liveCategoryID":"categoryID").toString();if(!id.isEmpty())names[id]=live?liveTitles.value(liveCategories.indexOf(id)):i["categoryName"].toString();}QVariantList result;if(live){for(const auto&id:liveCategories)if(names.contains(id))result.append(QVariantMap{{"id",id},{"title",names[id]}});}else for(auto i=names.begin();i!=names.end();++i)result.append(QVariantMap{{"id",i.key()},{"title",i.value()}});return result;}
QVariantList countries(const QVariantList &rows){QSet<QString> used;for(const auto&v:rows)used.insert(v.toMap()["countryID"].toString());QVariantList result;for(const auto&id:countryOrder)if(used.contains(id))result.append(QVariantMap{{"id",id},{"title",countryTitles.value(id)}});return result;}
bool validItem(const QVariantMap &i,const QString &scope){auto kind=i.value("kind").toString();auto ext=i.value("extension").toString();return i.value("scope")==scope&&QStringList{"live","movie","series","episode"}.contains(kind)&&!id(QJsonValue::fromVariant(i.value("id"))).isEmpty()&&(kind=="episode"?!id(QJsonValue::fromVariant(i.value("seriesID"))).isEmpty():i.value("seriesID").toString().isEmpty())&&(ext.isEmpty()||extensions.contains(ext))&&(i.value("artworkURL").toString().isEmpty()||artwork(QJsonValue::fromVariant(i.value("artworkURL")))==i.value("artworkURL").toString())&&!i.contains("url")&&!i.contains("password");}
QVariantMap hero(const QString &route,const QVariantList &items,qint64 now){auto rows=ranked(items,now);for(const auto&v:rows){auto i=v.toMap();if(i["releaseYear"].toInt()==2026&&!i["artworkURL"].toString().isEmpty()&&(route!="movies"||i["kind"]=="movie")&&(i["kind"]=="movie"||i["kind"]=="series"))return i;}return {};}
QVariantList shelves(const QString &route,const QVariantList &items,qint64 now){auto pool=ranked(items,now);QVariantList result;auto add=[&](QString id,QString title,const std::function<bool(const QVariantMap&)> &predicate){QVariantList list;QSet<QString> titles;for(const auto&v:pool){auto i=v.toMap();auto identity=fold(i["title"].toString());if(predicate(i)&&!titles.contains(identity)){list.append(i);titles.insert(identity);}}list=covered(list);if(!list.isEmpty())result.append(QVariantMap{{"id",id},{"title",title},{"items",list}});};if(route=="home"){add("home-movies",QString::fromUtf8("2026 Filmleri"),[](auto&i){return i["kind"]=="movie"&&i["releaseYear"].toInt()==2026;});add("home-series",QString::fromUtf8("2026 Dizileri"),[](auto&i){return i["kind"]=="series"&&i["releaseYear"].toInt()==2026;});add("home-live",QString::fromUtf8("Canlı TV"),[](auto&i){return i["kind"]=="live";});}else if(route=="movies"){add("movies-2026",QString::fromUtf8("2026 Filmleri"),[](auto&i){return i["releaseYear"].toInt()==2026;});add("movies-marvel",QString::fromUtf8("Çok İzlenenler · Marvel"),[](auto&i){return matches(fold(i["title"].toString()),"\\b(?:marvel|avengers|yenilmezler|iron ?man|thor|captain america|kaptan amerika|spider.?man|orumcek adam|hulk|doctor strange|doktor strange|black panther|kara panter|ant.?man|karinca adam|guardians of the galaxy|galaksinin koruyuculari|black widow|kara dul|shang chi|eternals|deadpool|wolverine|x.?men|venom)\\b");});add("movies-action",QString::fromUtf8("Aksiyon Filmleri"),[](auto&i){return !i["artworkURL"].toString().isEmpty()&&matches(fold(i["categoryName"].toString()),"\\b(?:aksiyon|action)\\b");});add("movies-fantasy",QString::fromUtf8("Fantastik Filmler"),[](auto&i){auto c=fold(i["categoryName"].toString());return matches(fold(i["title"].toString()),"harry potter|fantastic beasts|fantastik canavarlar|lord of the rings|yuzuklerin efendisi|hobbit|narnia")||(matches(c,"fantastik|fantasy")&&!matches(c,"bilim kurgu|science fiction|sci fi|scifi"));});}else if(route=="series"){add("series-primary",QString::fromUtf8("Günün Seçkisi"),[](auto&i){return i["kind"]=="series";});auto groups=categories(pool,false);for(const auto&v:groups.mid(0,4)){auto c=v.toMap();add("series-"+c["id"].toString(),c["title"].toString(),[&](auto&i){return i["categoryID"]==c["id"];});}}return result;}
}
