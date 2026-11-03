#pragma once
#include <QtGlobal>

struct DeviceLoginLifetime {
    static int remaining(qint64 elapsedMs) { return int(qMax<qint64>(0, (180000 - qMax<qint64>(0, elapsedMs) + 999) / 1000)); }
    static bool canPoll(qint64 elapsedMs) { return elapsedMs < 240000; }
};
