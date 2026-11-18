import AppKit

@main struct ScrollSpeedTests {
    static func main() {
        func event(_ precise: Bool, _ y: Int32, _ x: Int32 = 0, flags: CGEventFlags = []) -> NSEvent {
            let cg = CGEvent(scrollWheelEvent2Source:nil, units:precise ? .pixel : .line,
                             wheelCount:2, wheel1:y, wheel2:x, wheel3:0)!
            cg.flags = flags
            return NSEvent(cgEvent:cg)!
        }
        let wheel = event(false, 4, -2)
        let fast = ScrollSpeed().applying(to:wheel)
        precondition(abs(fast.scrollingDeltaY / wheel.scrollingDeltaY - 1.5) < 0.01)
        precondition(abs(fast.scrollingDeltaX / wheel.scrollingDeltaX - 1.5) < 0.01)
        let slow = ScrollSpeed(["mouseScrollSpeed":0.5]).applying(to:wheel)
        precondition(abs(slow.scrollingDeltaY / wheel.scrollingDeltaY - 0.5) < 0.01)
        let pad = event(true, 20, -10)
        precondition(pad.hasPreciseScrollingDeltas)
        precondition(ScrollSpeed().applying(to:pad) === pad)
        let padFast = ScrollSpeed(["trackpadScrollSpeed":2]).applying(to:pad)
        precondition(padFast.scrollingDeltaY == pad.scrollingDeltaY * 2)
        for flags: CGEventFlags in [.maskCommand,.maskControl] {
            let zoom = event(true, 20, flags:flags)
            precondition(ScrollSpeed(["trackpadScrollSpeed":3]).applying(to:zoom) === zoom)
        }
        precondition(ScrollSpeed(["mouseScrollSpeed":Double.nan]).mouse == 1.5)
        precondition(ScrollSpeed(["mouseScrollSpeed":100]).mouse == 3)
        precondition(ScrollSpeed(["mouseScrollSpeed":0]).mouse == 0.5)
        precondition(ScrollSpeed(["mouseScrollSpeed":1]).applying(to:wheel) === wheel)
        // Native phase codes differ from NSEvent.Phase raw values. Test the
        // entire direct + momentum sequence at every supported speed.
        let phases: [(Int64, Int64, Int32)] = [(1,0,0),(2,0,12),(2,0,-8),(4,0,0),(0,1,8),(0,2,4),(0,3,0)]
        for speed in [0.5,0.75,1,1.25,1.5,2,3] {
            let settings = ScrollSpeed(["trackpadScrollSpeed":speed])
            for (phase,momentum,delta) in phases {
                let cg = CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:2,wheel1:delta,wheel2:0,wheel3:0)!
                cg.setIntegerValueField(.scrollWheelEventScrollPhase,value:phase)
                cg.setIntegerValueField(.scrollWheelEventMomentumPhase,value:momentum)
                cg.location = CGPoint(x:150,y:200)
                let original = NSEvent(cgEvent:cg)!, scaled = settings.applying(to:original)
                precondition(scaled.phase == original.phase && scaled.momentumPhase == original.momentumPhase)
                precondition(scaled.hasPreciseScrollingDeltas && scaled.locationInWindow == original.locationInWindow)
                precondition(scaled.timestamp == original.timestamp)
                precondition(abs(scaled.scrollingDeltaY - original.scrollingDeltaY * speed) < 0.01)
                if delta == 0 { precondition(scaled === original) }
            }
        }
        print("Trackpad: all 7 speeds preserve start/change/end, momentum, zero-delta boundaries and location")
        print("Scroll speed: mouse/trackpad, both axes, system speed, bounds and zoom gesture tests passed")
    }
}
