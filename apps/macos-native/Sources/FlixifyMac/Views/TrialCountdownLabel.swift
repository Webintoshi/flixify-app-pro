import FlixifyCore
import SwiftUI

struct TrialCountdownLabel: View {
    let countdown: TrialCountdown
    var body: some View {
        if countdown.status() != .none {
            TimelineView(.periodic(from: Date(), by: 1)) { _ in
                Text(countdown.text()).monospacedDigit()
            }
        }
    }
}
