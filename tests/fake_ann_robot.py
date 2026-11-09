"""A virtual Thymio 3 for running src/py/ann_mode.py (and src/py/ai_mode.py) off the robot.

It stands in for the `thymio` and `time` modules of MicroPython, with a virtual clock
(sleep_ms advances time instead of waiting) that moves in whole ticks of the mode (20 ms):
the test sets what the sensors and the buttons say for the next tick in `on_tick`, and reads
what the mode did (motors, LEDs, sounds, the "@@" lines it printed) with the number of the tick.

The proximity sensors are whatever the test says (`robot.prox`), or, with `Wall`, what they
would read in front of a wall: the same curve as the web interface's virtual robot
(src/sim/arena.js: proxFromDistance).
"""
import math
import types

TICK_MS = 20
MM_PER_S_PER_UNIT = 150.0 / 1.8 / 300.0      # the factory 15 cm = 9 000 000 ticks at speed 300


class StopSim(Exception):
    pass


def prox_from_distance(d_mm):
    """What a front sensor reads at this distance (mm) from an obstacle straight ahead."""
    if d_mm >= 110:
        return 0
    v = 4500.0 * (1.0 - d_mm / 110.0) ** 2
    return int(min(4095, v))


class Led:
    def __init__(self, bank, i):
        self.bank, self.i = bank, i

    def intensity(self, v):
        if not isinstance(v, int) or not 0 <= v <= 16:
            raise ValueError("LED out of range %r" % (v,))
        self.bank[self.i] = v


class Rgb:
    def __init__(self, robot, i):
        self.robot, self.i = robot, i

    def set_intensity(self, r, g, b):
        if not all(isinstance(v, int) and 0 <= v <= 16 for v in (r, g, b)):
            raise ValueError("RGB out of range %r" % ((r, g, b),))
        self.robot.rgb[self.i] = (r, g, b)
        self.robot.rgb_writes.append((self.robot.tick, self.i, r, g, b))

    def get_intensity_red(self):
        return self.robot.rgb[self.i][0]

    def get_intensity_green(self):
        return self.robot.rgb[self.i][1]

    def get_intensity_blue(self):
        return self.robot.rgb[self.i][2]


class VirtualRobot:
    def __init__(self):
        self.t_ms = 0
        self.tick = 0                      # the tick the mode is in (0 = the first)
        self.prox = [0] * 7
        self.ground = [900, 900]          # the two ground sensors (lower is darker)
        self.buttons = [0, 0, 0, 0, 0]     # BACKWARD, LEFT, CENTER, FORWARD, RIGHT
        self.rgb = [(0, 0, 0)] * 4
        self.rgb_writes = []
        self.circle = [0] * 8
        self.lego_f = [0] * 8
        self.lego_b = [0] * 8
        self.speed = (0, 0)
        self.speeds = []                   # (tick, left, right) at every set_speed
        self.sounds = []                   # (tick, id)
        self.lines = []                    # (tick, text) of every "@@" line the mode printed
        self.behaviors_enabled = True
        self.on_tick = None                # callable(robot): sets the inputs of the tick that is about to run
        self.max_ticks = None
        self.print_buffer = ""
        self.last = {}                     # what the robot showed and did when the last tick ended (before the mode's cleanup)

    def inject(self, frame):
        """What the Bluetooth command does: the four body LEDs are given twelve 4-bit values."""
        self.rgb = [tuple(frame[3 * i:3 * i + 3]) for i in range(4)]

    def last_lines(self, word):
        return [t for _, t in self.lines if t.split(" ")[0] == "@@" + word]


class Wall:
    """A wall straight ahead of the robot, `distance` mm away at the start; the robot drives at the
    speed the mode gives it (the mean of both wheels) and the front centre sensor reads the wall."""

    def __init__(self, robot, distance):
        self.robot = robot
        self.distance = float(distance)
        robot.on_tick = self.step

    def step(self, robot):
        l, r = robot.speed
        self.distance -= (l + r) / 2.0 * MM_PER_S_PER_UNIT * TICK_MS / 1000.0
        d = max(0.0, self.distance)
        robot.prox = [0, 0, prox_from_distance(d), 0, 0, 0, 0]


def make_modules(robot):
    class Behaviors:
        def disable_behaviors(self):
            robot.behaviors_enabled = False

        def enable_behaviors(self):
            robot.behaviors_enabled = True

        def enable_leds_proximity(self):
            pass

    class Motors:
        def set_speed(self, l, r):
            if not isinstance(l, int) or not isinstance(r, int):
                raise TypeError("speeds must be int")
            if abs(l) > 1000 or abs(r) > 1000:
                raise ValueError("speed out of range")
            robot.speed = (l, r)
            robot.speeds.append((robot.tick, l, r))

    class Buttons:
        def get_status(self):
            return list(robot.buttons)

    class Sound:
        def stop(self):
            pass

        def play_onboard(self, i):
            robot.sounds.append((robot.tick, i))

    class Prox:
        def __init__(self, i):
            self.i = i

        def value(self):
            return robot.prox[self.i]

    class Ground:
        def __init__(self, i):
            self.i = i

        def value(self):
            return robot.ground[self.i]

    th = types.ModuleType("thymio")
    th.BEHAVIORS = Behaviors
    th.MOTORS = Motors
    th.BUTTONS = Buttons
    th.SOUND = Sound
    th.LEDS_RGB = lambda i: Rgb(robot, i)
    th.LEDS_CIRCLE = lambda i: Led(robot.circle, i)
    th.LEDS_LEGO_FRONT = lambda i: Led(robot.lego_f, i)
    th.LEDS_LEGO_BACK = lambda i: Led(robot.lego_b, i)
    th.PROXIMITY = Prox
    th.GROUND = Ground
    th.get_battery_voltage = lambda: 4012

    tm = types.ModuleType("time")
    tm.ticks_ms = lambda: robot.t_ms
    tm.ticks_us = lambda: robot.t_ms * 1000
    tm.ticks_diff = lambda a, b: a - b

    def sleep_ms(n):
        robot.last = {"speed": robot.speed, "circle": list(robot.circle), "lego_f": list(robot.lego_f),
                      "lego_b": list(robot.lego_b), "rgb": list(robot.rgb)}
        robot.t_ms += n
        robot.tick += 1
        if robot.max_ticks is not None and robot.tick >= robot.max_ticks:
            raise StopSim()
        if robot.on_tick:
            robot.on_tick(robot)

    tm.sleep_ms = sleep_ms
    return th, tm


def load(source, robot, extra="", name="ann_mode"):
    """Run the mode's source (plus `extra`, e.g. a final run(...)) on the virtual robot until max_ticks."""
    import sys
    thymio_mod, time_mod = make_modules(robot)

    def fake_print(*args, **kw):
        text = "".join(str(a) for a in args)
        robot.print_buffer += text
        while "\x1e" in robot.print_buffer:
            line, robot.print_buffer = robot.print_buffer.split("\x1e", 1)
            robot.lines.append((robot.tick, line.strip()))

    saved = {k: sys.modules.get(k) for k in ("thymio", "time")}
    sys.modules["thymio"], sys.modules["time"] = thymio_mod, time_mod
    ns = {"print": fake_print, "__name__": name}
    try:
        exec(compile(source + extra, name + ".py", "exec"), ns)
    except StopSim:
        pass
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return ns
