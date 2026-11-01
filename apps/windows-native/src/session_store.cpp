#include "session_store.h"
#include "catalog.h"
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QSaveFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QCryptographicHash>
#include <QDateTime>
#include <QUuid>
#include <QRegularExpression>
#include <algorithm>
#ifdef Q_OS_WIN
#define NOMINMAX
#include <windows.h>
#include <wincrypt.h>
#endif
namespace {
bool secret(const QString &s,int max){return !s.isEmpty()&&s.size()<=max&&!s.contains(QRegularExpression("[\\x00-\\x1f\\x7f]"));}
QByteArray readBounded(const QString &path,qint64 maximum){QFileInfo info(path);if(!info.isFile()||info.isSymLink()||info.size()>maximum)return {};QFile f(path);if(!f.open(QIODevice::ReadOnly))return {};return f.read(maximum+1);}
bool atomic(const QString &path,const QByteArray &bytes){QDir().mkpath(QFileInfo(path).absolutePath());QSaveFile file(path);if(!file.open(QIODevice::WriteOnly))return false;file.setPermissions(QFileDevice::ReadOwner|QFileDevice::WriteOwner);return file.write(bytes)==bytes.size()&&file.commit();}
QString progressKey(const QVariantMap &item){return MetadataStore::hash(item.value("scope").toString()+':'+Catalog::key(item));}
}
bool StoredSession::valid() const {return secret(accessToken,16384)&&secret(refreshToken,16384)&&secret(accountID,256)&&!accountID.contains(':')&&codeSuffix.size()<=4;}
SessionStore::SessionStore(QString path,bool vol):root(std::move(path)),volatileOnly(vol){}
StoredSession SessionStore::load() const {
    if(volatileOnly)return memory;
#ifdef Q_OS_WIN
    auto bytes=readBounded(root+"/session.bin",65536);if(bytes.isEmpty())return {};DATA_BLOB in{DWORD(bytes.size()),reinterpret_cast<BYTE *>(bytes.data())},out{};
    if(!CryptUnprotectData(&in,nullptr,nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&out))return {};
    auto clear=QByteArray(reinterpret_cast<char*>(out.pbData),int(out.cbData));SecureZeroMemory(out.pbData,out.cbData);LocalFree(out.pbData);auto object=QJsonDocument::fromJson(clear).object();clear.fill('\0');StoredSession value{object["accessToken"].toString(),object["refreshToken"].toString(),object["accountID"].toString(),object["codeSuffix"].toString()};return value.valid()?value:StoredSession{};
#else
    return {};
#endif
}
bool SessionStore::save(const StoredSession &value){if(!value.valid())return false;if(volatileOnly){memory=value;return true;}
#ifdef Q_OS_WIN
    auto bytes=QJsonDocument(QJsonObject{{"accessToken",value.accessToken},{"refreshToken",value.refreshToken},{"accountID",value.accountID},{"codeSuffix",value.codeSuffix}}).toJson(QJsonDocument::Compact);DATA_BLOB in{DWORD(bytes.size()),reinterpret_cast<BYTE*>(bytes.data())},out{};if(!CryptProtectData(&in,L"Flixify session",nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&out)){bytes.fill('\0');return false;}bytes.fill('\0');QByteArray encrypted(reinterpret_cast<char*>(out.pbData),int(out.cbData));LocalFree(out.pbData);return atomic(root+"/session.bin",encrypted);
#else
    return false;
#endif
}
void SessionStore::clear(){memory={};QFile::remove(root+"/session.bin");}
QString SessionStore::installationID(){auto bytes=readBounded(root+"/installation",64);auto existing=QString::fromLatin1(bytes);if(!QUuid(existing).isNull())return existing;auto value=QUuid::createUuid().toString(QUuid::WithoutBraces);return atomic(root+"/installation",value.toLatin1())?value:QString();}
MetadataStore::MetadataStore(QString r):root(std::move(r)){}
QString MetadataStore::hash(const QString &s){return QString::fromLatin1(QCryptographicHash::hash(s.toUtf8(),QCryptographicHash::Sha256).toHex());}
QString MetadataStore::path(const QString &scope,const QString &name)const{return root+"/metadata/"+hash(scope+QChar(0)+name)+".json";}
QVariant MetadataStore::read(const QString &scope,const QString &name,qint64 expiry,qint64 now,qint64 *savedAt)const {if(expiry<=now)return {};auto bytes=readBounded(path(scope,name),20*1024*1024);if(bytes.isEmpty())return {};auto r=QJsonDocument::fromJson(bytes).object();auto saved=r["savedAt"].toVariant().toLongLong(),deadline=r["expiresAt"].toVariant().toLongLong();if(r["version"].toInt()!=1||r["scope"].toString()!=scope||saved>now||now-saved>=7LL*86400000||deadline<=now)return {};if(savedAt)*savedAt=saved;return r["value"].toVariant();}
QByteArray MetadataStore::encode(const QString &scope,const QVariant &value,qint64 expiry,qint64 now){
    if(scope.isEmpty()||expiry<=now)return {};
    auto bytes=QJsonDocument(QJsonObject{{"version",1},{"scope",scope},{"savedAt",now},{"expiresAt",expiry},{"value",QJsonValue::fromVariant(value)}}).toJson(QJsonDocument::Compact);
    return bytes.size()<=20*1024*1024?bytes:QByteArray{};
}
void MetadataStore::writeEncoded(const QString &scope,const QString &name,const QByteArray &bytes){
    if(scope.isEmpty()||bytes.isEmpty()||bytes.size()>20*1024*1024)return;if(atomic(path(scope,name),bytes))trim();
}
void MetadataStore::write(const QString &scope,const QString &name,const QVariant &value,qint64 expiry,qint64 now){writeEncoded(scope,name,encode(scope,value,expiry,now));}
void MetadataStore::trim(){auto entries=QDir(root+"/metadata").entryInfoList({"*.json"},QDir::Files|QDir::NoSymLinks,QDir::Time|QDir::Reversed);qint64 size=0;for(const auto&e:entries)size+=e.size();int count=entries.size();for(const auto&e:entries){if(count<=128&&size<=32*1024*1024)break;if(QFile::remove(e.absoluteFilePath())){count--;size-=e.size();}}}
QVariantMap MetadataStore::progress()const {auto r=QJsonDocument::fromJson(readBounded(root+"/progress.json",1024*1024)).object().toVariantMap();return r.size()<=2000?r:QVariantMap{};}
qint64 MetadataStore::position(const QVariantMap &item)const {auto kind=item.value("kind").toString();if(kind!="movie"&&kind!="episode")return 0;return qMax(qint64(0),progress().value(progressKey(item)).toMap().value("position").toLongLong());}
QVariantMap MetadataStore::latestEpisode(const QVariantList &episodes)const {auto records=progress();QVariantMap selected;qint64 latest=0;for(const auto&v:episodes){auto item=v.toMap();auto record=records.value(progressKey(item)).toMap();if(record.value("position").toLongLong()>0&&record.value("updatedAt").toLongLong()>latest){latest=record["updatedAt"].toLongLong();selected=item;}}return selected;}
void MetadataStore::saveProgress(const QVariantMap &item,qint64 pos,qint64 duration,qint64 now){auto kind=item.value("kind").toString();if((kind!="movie"&&kind!="episode")||item.value("scope").toString().isEmpty()||pos<0||duration<=0)return;auto records=progress();auto k=progressKey(item);if(pos>=duration-qMin(qint64(15000),duration/20))records.remove(k);else records[k]=QVariantMap{{"position",qMin(pos,duration)},{"updatedAt",now}};while(records.size()>2000){auto oldest=records.begin();for(auto i=records.begin();i!=records.end();++i)if(i.value().toMap()["updatedAt"].toLongLong()<oldest.value().toMap()["updatedAt"].toLongLong())oldest=i;records.erase(oldest);}atomic(root+"/progress.json",QJsonDocument::fromVariant(records).toJson(QJsonDocument::Compact));}
