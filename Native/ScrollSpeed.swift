import AppKit

struct ScrollSpeed {
    var mouse: Double = 1.5
    var trackpad: Double = 1

    init(_ preferences: [String: Any] = [:]) {
        mouse = Self.valid(preferences["mouseScrollSpeed"], fallback: 1.5)
        trackpad = Self.valid(preferences["trackpadScrollSpeed"], fallback: 1)
    }
    static func valid(_ value: Any?, fallback: Double) -> Double {
        guard let number = value as? NSNumber, number.doubleValue.isFinite else { return fallback }
        return min(3, max(0.5, number.doubleValue))
    }
    func applying(to event: NSEvent) -> NSEvent {
        // Modified wheels belong to zoom gestures, not document scrolling.
        guard event.type == .scrollWheel,
              event.modifierFlags.intersection([.command, .control]).isEmpty else { return event }
        let factor = event.hasPreciseScrollingDeltas ? trackpad : mouse
        // Preserve zero-delta gesture boundaries exactly as AppKit delivered them.
        if event.scrollingDeltaX == 0 && event.scrollingDeltaY == 0 { return event }
        guard factor != 1, let copy = event.cgEvent?.copy() else { return event }
        let fields: [CGEventField] = [.scrollWheelEventDeltaAxis1, .scrollWheelEventDeltaAxis2,
                                    .scrollWheelEventFixedPtDeltaAxis1, .scrollWheelEventFixedPtDeltaAxis2,
                                    .scrollWheelEventPointDeltaAxis1, .scrollWheelEventPointDeltaAxis2]
        // Quartz can update related fields when one delta is written. Snapshot
        // all original values first so the multiplier is applied exactly once.
        let values = fields.map { copy.getDoubleValueField($0) * factor }
        for (field, value) in zip(fields, values) {
            copy.setDoubleValueField(field, value: value)
        }
        return NSEvent(cgEvent: copy) ?? event
    }
}
