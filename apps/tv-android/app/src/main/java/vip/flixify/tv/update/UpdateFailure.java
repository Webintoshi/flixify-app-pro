package vip.flixify.tv.update;

import java.io.IOException;

final class UpdateFailure extends IOException {
    UpdateFailure() {super("Güncelleme doğrulanamadı. Tekrar deneyebilirsiniz.");}
    UpdateFailure(String safeMessage) {super(safeMessage);}
}
