#include <QtTest>
#include "catalog.h"
#include "session_store.h"
#include <QTemporaryDir>
#include <QFile>
class CatalogTest : public QObject {
    Q_OBJECT
private slots:
    void turkishSearchMatchesAllCatalogEntries() {
        QCOMPARE(Catalog::search(QString::fromUtf8("İSTANBUL ışıĞı ÇÖŞÜ")), QString("istanbulisigicosu"));
        QVariantList rows;
        for (int i=1;i<=900;i++) rows.append(QVariantMap{{"id",QString::number(i)},{"kind","series"},{"title",i==900?QString::fromUtf8("Işık İstanbul"):QString("Dizi %1").arg(i)},{"scope","a:v"}});
        auto filtered=Catalog::filter(rows,"isik istanbul",{},{});
        QCOMPARE(filtered.size(),1); QCOMPARE(filtered.first().toMap().value("id").toString(),QString("900"));
    }
    void moviePolicyAndYearAreStrict() {
        QJsonArray groups{QJsonObject{{"category_id","1"},{"category_name","TR | Aksiyon (Yabancı)"}},QJsonObject{{"category_id","2"},{"category_name","Adult"}}};
        QJsonArray rows{QJsonObject{{"stream_id",1},{"name","Film (2026)"},{"category_id","1"},{"container_extension","MKV"}},QJsonObject{{"stream_id",2},{"name","Blocked"},{"category_id","2"},{"container_extension","mp4"}},QJsonObject{{"stream_id",3},{"name","Conflict (2026)"},{"year",2025},{"release_year",2026},{"category_id","1"},{"container_extension","mp4"}}};
        auto result=Catalog::parse("movie",rows,groups,"account:v"); QCOMPARE(result.size(),2);
        QCOMPARE(result.first().toMap().value("releaseYear").toInt(),2026); QCOMPARE(result.last().toMap().value("releaseYear").toInt(),0);
    }
    void livePrefersFhdAndKeepsCountryIsolation() {
        QJsonArray groups{QJsonObject{{"category_id","1"},{"category_name","TR | Ulusal"}},QJsonObject{{"category_id","2"},{"category_name","DE | Ulusal"}}};
        QJsonArray rows;
        for(auto row : QList<QPair<QString,QString>>{{"1","TR | TRT 1 HD"},{"2","TR | TRT 1 FHD"},{"3","TR | TRT 1 FHD HEVC"},{"4","DE | TRT 1 FHD"},{"5","TR | TRT 4K"},{"6",QString::fromUtf8("TR | TRT 1 ꜰʜᴅ")}}) rows.append(QJsonObject{{"stream_id",row.first},{"name",row.second},{"category_id",row.first=="4"?"2":"1"}});
        auto result=Catalog::curateLive(Catalog::parse("live",rows,groups,"a:v"),{});
        QCOMPARE(result.size(),2); QCOMPARE(result.first().toMap().value("id").toString(),QString("2")); QCOMPARE(result.first().toMap().value("title").toString(),QString("TRT 1"));
        result=Catalog::curateLive(Catalog::parse("live",rows,groups,"a:v"),{"2","6"}); QCOMPARE(result.first().toMap().value("id").toString(),QString("1"));
    }
    void categoryAndCountryIntersect() {
        QVariantList rows{QVariantMap{{"kind","live"},{"title","TRT"},{"countryID","tr"},{"liveCategoryID","national"}},QVariantMap{{"kind","live"},{"title","Spor"},{"countryID","tr"},{"liveCategoryID","sports"}},QVariantMap{{"kind","live"},{"title","Sport"},{"countryID","de"},{"liveCategoryID","sports"}}};
        QCOMPARE(Catalog::filter(rows,{},"sports","tr").size(),1);
    }
    void cachePartitionsSourcesAndRejectsExpiry() {
        QTemporaryDir dir; MetadataStore cache(dir.path());
        cache.write("account:v1","catalog",QVariantList{QVariantMap{{"id","1"}}},10000,1000);
        QVERIFY(cache.read("account:v2","catalog",10000,2000).isNull());
        QCOMPARE(cache.read("account:v1","catalog",10000,2000).toList().size(),1);
        QVERIFY(cache.read("account:v1","catalog",2000,2000).isNull());
    }
    void progressSeparatesSourcesAndClearsCompletion() {
        QTemporaryDir dir; MetadataStore store(dir.path());
        QVariantMap a{{"id","1"},{"kind","episode"},{"seriesID","9"},{"scope","a:v1"}};
        store.saveProgress(a,30000,100000,1000); QCOMPARE(store.position(a),30000);
        auto b=a;b["scope"]="a:v2"; QCOMPARE(store.position(b),0);
        store.saveProgress(a,96000,100000,2000); QCOMPARE(store.position(a),0);
    }
    void seriesOrderingAndMalformedArtwork() {
        QVariantMap parent{{"id","9"},{"kind","series"},{"scope","a:v"}};
        QJsonObject raw{{"episodes",QJsonObject{{"2",QJsonArray{QJsonObject{{"id","22"},{"season",2},{"episode_num",1},{"container_extension","mp4"}}}},{"1",QJsonArray{QJsonObject{{"id","11"},{"season",1},{"episode_num",2},{"container_extension","mkv"}}}}}}};
        auto detail=Catalog::series(raw,parent);auto episodes=Catalog::episodes(detail);
        QCOMPARE(episodes.size(),2);QCOMPARE(episodes.first().toMap().value("id").toString(),QString("11"));
        QVERIFY(Catalog::artwork("https://host/a?password=private").isEmpty());QVERIFY(Catalog::id(QJsonValue(true)).isEmpty());
    }
    void windowsVaultEncryptsAndRejectsTampering() {
#ifdef Q_OS_WIN
        QTemporaryDir dir;SessionStore vault(dir.path());StoredSession tokens{"fixture-access-token","fixture-refresh-token","fixture-account","TEST"};QVERIFY(vault.save(tokens));QCOMPARE(vault.load().accountID,QString("fixture-account"));QFile file(dir.path()+"/session.bin");QVERIFY(file.open(QIODevice::ReadOnly));auto bytes=file.readAll();file.close();QVERIFY(!bytes.contains("fixture-access-token"));QVERIFY(!bytes.contains("fixture-refresh-token"));QVERIFY(file.open(QIODevice::WriteOnly|QIODevice::Truncate));QVERIFY(file.write("corrupt protected payload")>0);file.close();QVERIFY(!vault.load().valid());vault.clear();QVERIFY(!QFile::exists(file.fileName()));
#else
        QSKIP("DPAPI behavioral verification requires Windows.");
#endif
    }

};
QTEST_GUILESS_MAIN(CatalogTest)
#include "catalog_test.moc"
