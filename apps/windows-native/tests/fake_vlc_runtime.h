#pragma once
#include <QStringList>

namespace FakeVlc {
void reset();
void block(const QString &operation);
bool awaitBlocked(int timeoutMs = 5000);
void unblock();
QStringList calls();
bool calledOnGuiThread();
int concurrentCalls();
void finishAt(qint64 position, qint64 duration);
double appliedRate();
QString appliedAspect();
void failAttach(int event);
}
