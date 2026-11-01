#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QVariantList>
#include <QVariantMap>
#include <QSet>
#include <QUrl>
namespace Catalog {
QString clean(const QJsonValue &, int maximum = 512);
QString search(QString);
QString fold(QString);
QString id(const QJsonValue &);
QString artwork(const QJsonValue &);
QString key(const QVariantMap &);
QVariantList parse(const QString &kind, const QJsonArray &rows, const QJsonArray &groups, const QString &scope);
QVariantList curateLive(const QVariantList &, const QSet<QString> &excluded, QHash<QString,QString> *aliases = nullptr);
QVariantList filter(const QVariantList &, const QString &query, const QString &category, const QString &country);
QVariantMap series(const QJsonObject &, const QVariantMap &parent);
QVariantList episodes(const QVariantMap &detail);
QVariantList epg(const QJsonObject &);
QVariantList shelves(const QString &route, const QVariantList &, qint64 now);
QVariantMap hero(const QString &route, const QVariantList &, qint64 now);
QVariantList categories(const QVariantList &, bool live);
QVariantList countries(const QVariantList &);
bool validItem(const QVariantMap &, const QString &scope);
int releaseYear(const QJsonObject &, const QString &title);
}
