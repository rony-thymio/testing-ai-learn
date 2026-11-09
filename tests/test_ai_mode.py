"""Tests of src/py/ai_mode.py (the AI Lab program) on a virtual robot.

    python3 -I tests/test_ai_mode.py                                  (from the project root)
    python3 -I tests/test_ai_mode.py --golden tests/golden-ai.json

--golden writes the inputs and the outputs of two random scenarios; tests/ai.test.js replays the same inputs
through the JavaScript twin of the program (src/sim/ai-mode.js, the virtual robot) and compares, tick by tick.
"""
import json
import os
import random
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fake_ann_robot import VirtualRobot, load  # noqa: E402
from test_ann_mode import encode  # noqa: E402

SOURCE = open(os.path.join(HERE, "..", "src", "py", "ai_mode.py")).read()

KEY_CMD, KEY_ACTION, KEY_DURATION, KEY_PAUSE, KEY_MAX_SPEED, KEY_LIGHT, KEY_TURN_GAIN = 19, 20, 21, 22, 23, 24, 25
CMD_QUIT, CMD_STOP = 6, 8
FORWARD, BACKWARD, STOP, TURN_90_LEFT, TURN_90_RIGHT, RED = 1, 2, 0, 17, 18, 24


def run(robot, ticks, args=""):
    robot.max_ticks = ticks
    return load(SOURCE, robot, "\nrun(%s)\n" % args, name="ai_mode")


def send_at(robot, schedule):
    """schedule: {tick: [(key, value), ...]}: the message is written in the LEDs before that tick, one frame per tick."""
    queue = {}
    msg = [0]
    for tick, items in sorted(schedule.items()):
        msg[0] = msg[0] % 15 + 1
        for k, f in enumerate(encode(items, msg[0])):
            queue[tick + k] = f

    def on_tick(r):
        if r.tick in queue:
            r.inject(queue[r.tick])
    robot.on_tick = on_tick


def words(robot, word):
    return [(t, [int(x) for x in ln.split(" ")[1:]]) for t, ln in robot.lines if ln.split(" ")[0] == "@@" + word]


class Start(unittest.TestCase):
    def test_hello_settings_and_reports(self):
        r = VirtualRobot()
        r.prox = [0, 100, 2000, 300, 0, 0, 4000]
        r.ground = [850, 120]
        run(r, 30)
        self.assertEqual(words(r, "hello")[0][1], [2])
        self.assertEqual(words(r, "s")[0][1], [25, 10, 150, 100])     # the defaults: 0.25 s, 0.1 s, speed 150, 100 %
        a = words(r, "a")
        self.assertTrue(5 <= len(a) <= 6, "a report every 100 ms")
        # idle, no action yet, the 7 sensors, the 2 ground sensors, the wheels stopped
        self.assertEqual(a[-1][1], [0, -1, 0, 100, 2000, 300, 0, 0, 4000, 850, 120, 0, 0])
        self.assertTrue(all(s == (0, 0) for s in [(l, rr) for _, l, rr in r.speeds]))

    def test_arguments(self):
        r = VirtualRobot()
        run(r, 3, "40, 0, 200, 90")
        self.assertEqual(words(r, "s")[0][1], [40, 0, 200, 90])

    def test_no_ground_sensors(self):
        # a robot whose MicroPython has no GROUND: the program runs, the ground reads -1
        r = VirtualRobot()
        src_saved = SOURCE
        try:
            import fake_ann_robot as f
            make = f.make_modules

            def without_ground(robot):
                th, tm = make(robot)
                del th.GROUND
                return th, tm
            f.make_modules = without_ground
            run(r, 12)
        finally:
            f.make_modules = make
        self.assertEqual(words(r, "a")[-1][1][9:11], [-1, -1])
        self.assertEqual(src_saved, SOURCE)


class Actions(unittest.TestCase):
    def test_forward_for_the_duration_then_pause_then_done(self):
        r = VirtualRobot()
        send_at(r, {5: [(KEY_ACTION, FORWARD)]})
        run(r, 60)
        go = words(r, "go")
        done = words(r, "done")
        self.assertEqual(go[0][1], [1, FORWARD])
        self.assertEqual(done[0][1], [1, FORWARD])
        moving = [t for t, l, rr in r.speeds if (l, rr) == (150, 150)]
        self.assertTrue(moving, "drives at the max speed")
        self.assertTrue(12 <= len(moving) <= 14, "for 0.25 s: %d ticks" % len(moving))
        # done comes after the action and the 0.1 s pause
        self.assertTrue(17 <= done[0][0] - go[0][0] <= 20, "%d ticks" % (done[0][0] - go[0][0]))
        self.assertEqual(r.speed, (0, 0))
        # the reports say the phase: acting, then idle with the last action
        phases = [v[0] for _, v in words(r, "a")]
        self.assertIn(1, phases)
        self.assertEqual(words(r, "a")[-1][1][:2], [0, FORWARD])
        self.assertEqual(words(r, "ack")[0][1], [1])

    def test_settings_then_action_in_one_message(self):
        r = VirtualRobot()
        send_at(r, {5: [(KEY_DURATION, 50), (KEY_PAUSE, 0), (KEY_MAX_SPEED, 200), (KEY_ACTION, BACKWARD)]})
        run(r, 60)
        back = [t for t, l, rr in r.speeds if (l, rr) == (-200, -200)]
        self.assertTrue(24 <= len(back) <= 26, "0.5 s backwards at 200: %d ticks" % len(back))
        self.assertEqual(words(r, "s")[-1][1], [50, 0, 200, 100])

    def test_turns_take_the_time_of_their_angle(self):
        def ticks_turning(action, gain=100):
            r = VirtualRobot()
            send_at(r, {3: [(KEY_TURN_GAIN, gain), (KEY_ACTION, action)]})
            run(r, 300)
            return [(l, rr) for t, l, rr in r.speeds if l != 0 or rr != 0]
        left = ticks_turning(TURN_90_LEFT)
        right = ticks_turning(TURN_90_RIGHT)
        self.assertEqual(left[0], (-150, 150))
        self.assertEqual(right[0], (150, -150))
        # 90 degrees at 150: 1.571 rad * 94 / (2 * 150 * 0.2778 mm/s) = 1.77 s, about 89 ticks
        self.assertTrue(86 <= len(left) <= 91, len(left))
        self.assertEqual(len(left), len(right))
        self.assertTrue(abs(len(ticks_turning(TURN_90_LEFT, 50)) - len(left) / 2) <= 2, "the gain scales the time")

    def test_a_new_action_replaces_the_one_that_runs(self):
        r = VirtualRobot()
        send_at(r, {5: [(KEY_DURATION, 100), (KEY_ACTION, FORWARD)], 15: [(KEY_ACTION, BACKWARD)]})
        run(r, 120)
        self.assertEqual([v for _, v in words(r, "go")], [[1, FORWARD], [2, BACKWARD]])
        self.assertEqual([v for _, v in words(r, "done")], [[2, BACKWARD]])
        fwd = [t for t, l, rr in r.speeds if (l, rr) == (150, 150)]
        self.assertTrue(max(fwd) < 17)

    def test_stop_command_and_red_light(self):
        r = VirtualRobot()
        send_at(r, {5: [(KEY_DURATION, 100), (KEY_ACTION, FORWARD)], 15: [(KEY_CMD, CMD_STOP)], 25: [(KEY_ACTION, RED)]})
        run(r, 40)
        self.assertEqual([v for _, v in words(r, "done")][0], [1, FORWARD])
        self.assertEqual(r.speed, (0, 0))
        self.assertEqual(r.last["rgb"][1], (16, 0, 0), "the red light is on")

    def test_light_of_the_page(self):
        r = VirtualRobot()
        send_at(r, {3: [(KEY_LIGHT, (0 << 8) | (15 << 4) | 0)]})
        run(r, 12)
        self.assertEqual(r.last["rgb"][1], (0, 15, 0))
        self.assertEqual(r.last["rgb"][0], (0, 14, 0), "never 15 in the channel of the messages")

    def test_unknown_action_is_ignored(self):
        r = VirtualRobot()
        send_at(r, {3: [(KEY_ACTION, 99)]})
        run(r, 12)
        self.assertEqual(words(r, "go"), [])
        self.assertEqual(words(r, "ack")[0][1], [1])


class Leaving(unittest.TestCase):
    def test_quit_command(self):
        r = VirtualRobot()
        send_at(r, {3: [(KEY_ACTION, FORWARD)], 6: [(KEY_CMD, CMD_QUIT)]})
        run(r, 40)
        self.assertTrue(r.last_lines("exit"))
        self.assertTrue(r.last_lines("bye"))
        self.assertTrue(r.behaviors_enabled)
        self.assertEqual(r.speed, (0, 0))

    def test_centre_button(self):
        r = VirtualRobot()

        def press(rb):
            rb.buttons = [0, 0, 1 if rb.tick >= 4 else 0, 0, 0]
        r.on_tick = press
        run(r, 40)
        self.assertTrue(r.last_lines("exit"))
        self.assertTrue(r.behaviors_enabled)


def golden_scenario(seed, ticks=1500):
    rnd = random.Random(seed)
    prox, ground = [], []
    p = [0] * 7
    g = [900, 900]
    for t in range(ticks):
        if rnd.random() < 0.1:
            p = [rnd.choice([0, 0, rnd.randint(0, 4095)]) for _ in range(7)]
        if rnd.random() < 0.05:
            g = [rnd.randint(50, 1000), rnd.randint(50, 1000)]
        prox.append(list(p))
        ground.append(list(g))
    schedule = {}
    t = 10
    while t < ticks - 100:
        items = []
        if rnd.random() < 0.3:
            items.append((KEY_DURATION, rnd.randint(1, 80)))
        if rnd.random() < 0.3:
            items.append((KEY_PAUSE, rnd.randint(0, 30)))
        if rnd.random() < 0.3:
            items.append((KEY_MAX_SPEED, rnd.choice([0, 77, 150, 155, 333])))
        if rnd.random() < 0.15:
            items.append((KEY_TURN_GAIN, rnd.randint(50, 200)))
        if rnd.random() < 0.15:
            items.append((KEY_LIGHT, rnd.choice([-1, 0x0F0, 0xF00, 0x123])))
        if rnd.random() < 0.1:
            items.append((KEY_CMD, CMD_STOP))
        items.append((KEY_ACTION, rnd.randint(0, 25)))
        schedule[t] = items
        t += rnd.randint(4, 60)
    r = VirtualRobot()
    frames = {}
    msg = 0
    for tick, items in sorted(schedule.items()):
        msg = msg % 15 + 1
        for k, f in enumerate(encode(items, msg)):
            frames[tick + k] = f

    def on_tick(rb):
        rb.prox = prox[rb.tick] if rb.tick < ticks else prox[-1]
        rb.ground = ground[rb.tick] if rb.tick < ticks else ground[-1]
        if rb.tick in frames:
            rb.inject(frames[rb.tick])
    r.prox = prox[0]
    r.ground = ground[0]
    r.on_tick = on_tick
    run(r, ticks)
    return {
        "seed": seed, "ticks": ticks, "prox": prox, "ground": ground,
        "frames": sorted([t, f] for t, f in frames.items()),
        "lines": [[t, ln] for t, ln in r.lines if not ln.startswith("@@bye")],
        "speeds": [[t, l, rr] for t, l, rr in r.speeds if t < ticks],
    }


class Golden(unittest.TestCase):
    def test_golden_file_is_up_to_date(self):
        path = os.path.join(HERE, "golden-ai.json")
        if not os.path.exists(path):
            self.skipTest("no golden file yet: python3 -I tests/test_ai_mode.py --golden tests/golden-ai.json")
        with open(path) as f:
            want = json.load(f)
        got = [golden_scenario(sc["seed"]) for sc in want["scenarios"]]
        self.assertEqual(got, want["scenarios"], "the program changed: run --golden again")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--golden":
        with open(sys.argv[2], "w") as f:
            json.dump({"scenarios": [golden_scenario(11), golden_scenario(29)]}, f, separators=(",", ":"))
        print("written", sys.argv[2])
    else:
        unittest.main()
