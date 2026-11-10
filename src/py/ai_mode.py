# Thymio 3 - the AI Lab program (learning in the style of AlphAI), in MicroPython.
#
# In the AI Lab the neural network runs in the web page, as AlphAI ran on the computer: the page reads the
# sensors, chooses an action (the one a student shows it, or the one the network prefers) and asks the robot to
# carry it out. This program is the robot's side: it reports what its sensors read, and it carries out one action
# at a time: it drives for the action's duration, stops for the pause, and says it is done.
#
#   phase 0  idle       waits for an action, stopped                              (dim blue, or the page's light)
#   phase 1  act        carries out the action                                    (white, or the page's light)
#   phase 2  rest       the pause between two actions, stopped
#
# Actions (see ACTIONS below and src/ai/actions.js, which must say the same): drive with both wheels at a share
# of the max speed for the duration, turn on the spot by an angle (the time it takes depends on the speed), stop,
# or switch a light on (red, green or blue). A new action replaces the one that runs.
#
# Buttons: centre = leave. The others do nothing.
#
# The page and the robot talk as in ann_mode.py: stdout and the four body LEDs.
#   robot -> page   "@@word ..." lines, see say(). Every 100 ms:
#                     @@a phase action p0..p6 g0 g1 left right
#                   (action: the one that runs or ran last, -1 before the first; g0 g1 the ground sensors, -1 when the
#                   robot has none), when an action starts and ends: @@go k action, @@done k action p0..p6 g0 g1
#                   (k counts the actions; the sensors as they read when it is done, for the page to choose the next
#                   one), and when a setting changes (and every 3 s): @@s duration pause maxSpeed turnGain
#                   (hundredths of a second, hundredths of a second, speed units, percent).
#   page -> robot   rx_poll() below.
import thymio
import time

# written by the page when the whole program is sent instead of the module (see run())
DURATION_CS = 25
PAUSE_CS = 10
MAX_SPEED = 150
TURN_GAIN = 100

TICK_MS = 20
REPORT_TICKS = 5            # the sensors are said every 100 ms
HEARTBEAT_TICKS = 150       # the settings are said again every 3 s
SPEED_LIMIT = 500
COAST_MS = 400              # without a pause, the wheels of a drive action keep turning this long for the next action to follow
MAXB = 16

# Turning on the spot: both wheels at the max speed, in opposite directions, for the time the angle takes. A speed
# unit is about 0.278 mm/s (the factory's 15 cm in 1.8 s at 300) and the wheels are 94 mm apart. TURN_GAIN (percent)
# corrects the time when the real robot turns too much or too little.
MM_PER_UNIT = 150.0 / 1.8 / 300.0
WHEEL_BASE = 94.0

# The actions, by number: (kind, a, b).
#   kind 0: drive, the left wheel at a % and the right wheel at b % of the max speed, for the duration
#   kind 1: turn on the spot by a degrees (positive: to the left)
#   kind 2: stop for the duration
#   kind 3: a light for the duration, stopped (a: 0 red, 1 green, 2 blue)
K_DRIVE = 0
K_TURN = 1
K_STOP = 2
K_LIGHT = 3
ACTIONS = [
    (K_STOP, 0, 0),             # 0  stop
    (K_DRIVE, 100, 100),        # 1  forward
    (K_DRIVE, -100, -100),      # 2  backward
    (K_DRIVE, 60, 100),         # 3  slight forward turn, left
    (K_DRIVE, 100, 60),         # 4  slight forward turn, right
    (K_DRIVE, 10, 100),         # 5  forward turn, left
    (K_DRIVE, 100, 10),         # 6  forward turn, right
    (K_DRIVE, -60, -100),       # 7  slight backward turn, to the left
    (K_DRIVE, -100, -60),       # 8  slight backward turn, to the right
    (K_DRIVE, -10, -100),       # 9  backward turn, to the left
    (K_DRIVE, -100, -10),       # 10 backward turn, to the right
    (K_TURN, 15, 0),            # 11 turn 15 degrees left
    (K_TURN, -15, 0),           # 12 turn 15 degrees right
    (K_TURN, 30, 0),            # 13
    (K_TURN, -30, 0),           # 14
    (K_TURN, 60, 0),            # 15
    (K_TURN, -60, 0),           # 16
    (K_TURN, 90, 0),            # 17
    (K_TURN, -90, 0),           # 18
    (K_TURN, 120, 0),           # 19
    (K_TURN, -120, 0),          # 20
    (K_TURN, 150, 0),           # 21
    (K_TURN, -150, 0),          # 22
    (K_TURN, 180, 0),           # 23 half a turn
    (K_LIGHT, 0, 0),            # 24 red light
    (K_LIGHT, 1, 0),            # 25 green light
    (K_LIGHT, 2, 0),            # 26 blue light
]
LIGHTS = [(MAXB, 0, 0), (0, MAXB, 0), (0, 0, MAXB)]

# the items of the page's messages (see rx_poll)
KEY_COMMAND = 19
KEY_ACTION = 20
KEY_DURATION = 21
KEY_PAUSE = 22
KEY_MAX_SPEED = 23
KEY_LIGHT = 24
KEY_TURN_GAIN = 25
KEY_ACTION_N = 26           # an action with its number (number * 32 + action, the number 1..63): an action whose number was
                            # just carried out is not carried out again (the page sends a message again when its answer is late)
CMD_QUIT = 6
CMD_STOP = 8

P_IDLE = 0
P_ACT = 1
P_REST = 2

# ---- hardware ---------------------------------------------------------------
beh = thymio.BEHAVIORS()
mot = thymio.MOTORS()
btn = thymio.BUTTONS()
rgb = [thymio.LEDS_RGB(i) for i in range(4)]            # FL, FR, BL, BR
prox = [thymio.PROXIMITY(i) for i in range(7)]
try:
    ground = [thymio.GROUND(0), thymio.GROUND(1)]
except Exception:
    ground = None


def say(*parts):
    # padded to 100 bytes and ended by \x1e so that the firmware sends it at once (see ann_mode.py)
    s = "@@" + " ".join([str(p) for p in parts])
    print(s + " " * (99 - len(s)) + "\x1e", end="")


def set_body(r, g, b):
    # the green channel of the front left LED never shows 15: that is how the page's messages are told from these lights
    rgb[0].set_intensity(r, g if g != 15 else 14, b)
    rgb[1].set_intensity(r, g, b)
    rgb[2].set_intensity(r, g, b)
    rgb[3].set_intensity(r, g, b)


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def turn_ms(degrees, speed, gain):
    # the time it takes to turn by this angle on the spot, both wheels at this speed
    if speed <= 0:
        return 0
    rad = abs(degrees) * 3.14159265 / 180.0
    return int(rad * WHEEL_BASE / (2.0 * speed * MM_PER_UNIT) * 1000.0 * gain / 100.0)


def plan(action, duration_ms, max_speed, gain):
    # what an action does: (left speed, right speed, milliseconds, light: -1 none, else its number in LIGHTS)
    kind, a, b = ACTIONS[action]
    if kind == K_DRIVE:
        return (a * max_speed // 100, b * max_speed // 100, duration_ms, -1)
    if kind == K_TURN:
        s = max_speed if a > 0 else -max_speed
        return (-s, s, turn_ms(a, max_speed, gain), -1)
    return (0, 0, duration_ms, a if kind == K_LIGHT else -1)


class Runner:
    def __init__(self, duration_cs, pause_cs, max_speed, turn_gain):
        self.duration_ms = clamp(duration_cs, 1, 500) * 10
        self.pause_ms = clamp(pause_cs, 0, 500) * 10
        self.max_speed = clamp(max_speed, 0, SPEED_LIMIT)
        self.turn_gain = clamp(turn_gain, 10, 400)
        self.phase = P_IDLE
        self.action = -1
        self.count = 0
        self.timer = 0
        self.length = 0
        self.ml = 0
        self.mr = 0
        self.lit = -1               # the light of a light action (see LIGHTS), -1: none
        self.light = -1             # the page's colour for the body (12 bits: r, g, b), -1: the program's own
        self.p = [0] * 7
        self.g = [-1, -1]
        self.coast = 0              # milliseconds the wheels keep turning after a drive action (no pause), waiting for the next
        self.ticks = 0
        self.beat = 0
        self.quit = False
        self.rx_msg = -1
        self.rx_got = {}
        self.rx_last = -1
        self.last_seq = -1          # the number of the last action carried out
        self.centre = 0

    # ---- actions --------------------------------------------------------------------------------
    def start(self, action):
        if action < 0 or action >= len(ACTIONS):
            return
        self.count += 1
        self.action = action
        self.ml, self.mr, self.length, self.lit = plan(action, self.duration_ms, self.max_speed, self.turn_gain)
        self.coast = 0
        self.phase = P_ACT
        self.timer = 0
        say("go", self.count, action)

    def done(self):
        say("done", self.count, self.action, *self.p + self.g)

    def stop_now(self):
        was = self.phase
        self.ml = 0
        self.mr = 0
        self.lit = -1
        self.coast = 0
        self.phase = P_IDLE
        self.timer = 0
        if was != P_IDLE:
            self.done()

    def run_phase(self):
        # one tick of the action that runs
        if self.phase == P_ACT:
            if self.timer >= self.length:
                self.lit = -1
                self.timer = 0
                if self.pause_ms == 0 and ACTIONS[self.action][0] == K_DRIVE:
                    # no pause: done now, and the wheels go on a moment, so that the next action follows without a jolt
                    self.phase = P_IDLE
                    self.coast = COAST_MS
                    self.done()
                    return
                self.ml = 0
                self.mr = 0
                self.phase = P_REST
            else:
                self.timer += TICK_MS
        elif self.phase == P_IDLE and self.coast > 0:
            self.coast -= TICK_MS
            if self.coast <= 0:
                self.ml = 0
                self.mr = 0
        if self.phase == P_REST:
            if self.timer >= self.pause_ms:
                self.phase = P_IDLE
                self.timer = 0
                self.done()
            else:
                self.timer += TICK_MS

    # ---- reports --------------------------------------------------------------------------------
    def report_settings(self):
        say("s", self.duration_ms // 10, self.pause_ms // 10, self.max_speed, self.turn_gain)
        self.beat = 0

    def report(self):
        say("a", self.phase, self.action, *self.p + self.g + [self.ml, self.mr])

    # ---- the page's messages -----------------------------------------------------------------------
    def item(self, key, v):
        if key == KEY_ACTION_N:
            n = v >> 5
            if n == self.last_seq:
                return              # already carried out: the message came again
            self.last_seq = n
            self.start(v & 31)
        elif key == KEY_ACTION:
            self.start(v)
        elif key == KEY_DURATION:
            self.duration_ms = clamp(v, 1, 500) * 10
        elif key == KEY_PAUSE:
            self.pause_ms = clamp(v, 0, 500) * 10
        elif key == KEY_MAX_SPEED:
            self.max_speed = clamp(v, 0, SPEED_LIMIT)
        elif key == KEY_TURN_GAIN:
            self.turn_gain = clamp(v, 10, 400)
        elif key == KEY_LIGHT:
            self.light = v if v >= 0 else -1
        elif key == KEY_COMMAND:
            if v == CMD_STOP:
                self.stop_now()
            elif v == CMD_QUIT:
                say("exit")
                self.quit = True

    def rx_poll(self):
        # Exactly the frames of ann_mode.py (see rx_poll there): twelve 4-bit values in the four body LEDs, the green of
        # the front left one at 15, a checksum; a message is a number of items (key, signed 12-bit value).
        if rgb[0].get_intensity_green() != 15:
            return
        n = []
        for i in range(4):
            led = rgb[i]
            n.append(led.get_intensity_red())
            n.append(led.get_intensity_green())
            n.append(led.get_intensity_blue())
        total = 5
        for i in range(11):
            total += (i + 1) * n[i]
        if (total & 15) != n[11]:
            return
        if n[0] != self.rx_msg:
            self.rx_msg = n[0]
            self.rx_got = {}
            self.rx_last = -1
        self.rx_got[n[2] & 7] = n[3:11]
        if n[2] & 8:
            self.rx_last = n[2] & 7
        if self.rx_last < 0:
            return
        stream = []
        for i in range(self.rx_last + 1):
            if i not in self.rx_got:
                return
            stream += self.rx_got[i]
        self.rx_got = {}
        self.rx_last = -1
        count = stream[0] * 16 + stream[1]
        if len(stream) < 2 + 5 * count:
            return
        msg = self.rx_msg
        before = (self.duration_ms, self.pause_ms, self.max_speed, self.turn_gain)
        pos = 2
        for k in range(count):
            key = stream[pos] * 16 + stream[pos + 1]
            v = (stream[pos + 2] << 8) | (stream[pos + 3] << 4) | stream[pos + 4]
            if v >= 2048:
                v -= 4096
            pos += 5
            self.item(key, v)
        say("ack", msg)
        if before != (self.duration_ms, self.pause_ms, self.max_speed, self.turn_gain):
            self.report_settings()

    # ---- one tick ---------------------------------------------------------------------------------
    def body(self):
        if self.lit >= 0:
            set_body(*LIGHTS[self.lit])
        elif self.light >= 0:
            set_body((self.light >> 8) & 15, (self.light >> 4) & 15, self.light & 15)
        elif self.phase == P_ACT:
            set_body(8, 8, 8)
        else:
            set_body(2, 2, 6)

    def sense(self):
        for i in range(7):
            self.p[i] = prox[i].value()
        if ground:
            self.g[0] = ground[0].value()
            self.g[1] = ground[1].value()

    def tick(self):
        status = btn.get_status()   # [BACKWARD, LEFT, CENTER, FORWARD, RIGHT]
        c = 1 if status[2] else 0
        if c and not self.centre:
            say("exit")
            self.quit = True
            return
        self.centre = c
        self.rx_poll()
        if self.quit:
            return
        self.sense()
        self.run_phase()
        self.ticks += 1
        if self.ticks % REPORT_TICKS == 0:
            self.report()
        self.beat += 1
        if self.beat >= HEARTBEAT_TICKS:
            self.report_settings()
        self.body()
        mot.set_speed(self.ml, self.mr)


def cleanup():
    try:
        mot.set_speed(0, 0)
        set_body(0, 0, 0)
    finally:
        beh.enable_behaviors()
        say("bye")


def run(duration_cs=None, pause_cs=None, max_speed=None, turn_gain=None):
    # duration_cs, pause_cs: the duration of an action and the pause after it, in hundredths of a second;
    # max_speed: the speed of the wheels (0..500); turn_gain: the correction of the turning time, in percent
    if duration_cs is None:
        duration_cs = DURATION_CS
    if pause_cs is None:
        pause_cs = PAUSE_CS
    if max_speed is None:
        max_speed = MAX_SPEED
    if turn_gain is None:
        turn_gain = TURN_GAIN
    beh.disable_behaviors()
    beh.enable_leds_proximity()
    try:
        r = Runner(duration_cs, pause_cs, max_speed, turn_gain)
        r.body()
        say("hello", 2)
        say("bat", thymio.get_battery_voltage())
        r.report_settings()
        while not r.quit:
            t0 = time.ticks_ms()
            r.tick()
            left = TICK_MS - time.ticks_diff(time.ticks_ms(), t0)
            if left > 0:
                time.sleep_ms(left)
    finally:
        cleanup()
