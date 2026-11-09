# AI Lab: AlphAI-style learning for the Thymio 3

This branch adds a second mode to Francesco Mondada's *Thymio · Neurones* app. The original mode (**Neurons**, the robot
learns by itself to avoid obstacles) is unchanged. The new mode (**AI Lab**) brings back what students did with AlphAI and the
Thymio 2 in the *Thymio & AI* activities (A1 First learning, A2 The Arena, A3 Keep the track, A4 Don't stay there,
A5 The autonomous car): teaching the robot with **examples** (supervised learning) and with **rewards** (reinforcement learning).

Switch between the two with **Neurons | AI Lab** in the top bar. Both work with the virtual robot and a real Thymio 3.

## How it works

As with AlphAI, the neural network runs in the page and the robot carries out actions:

```
 page  ──(Bluetooth: frames in the body LEDs)──▶  ai_mode.py on the robot: "do action 5", settings
 page  ◀─(stdout: "@@" lines)────────────────────  sensors every 100 ms, "action started", "action done"
```

The link is the same as the Neurons mode (see the French README): the program is installed once as a module
(`aim_<hash>.py`), then started by a two-line script; messages to it are written in the four body LEDs.

| File | Role |
| --- | --- |
| `src/py/ai_mode.py` | The robot's program: reports the 7 proximity sensors and the 2 ground sensors, carries out one action at a time (duration, pause, max speed) |
| `src/ai/actions.js` | The 25 actions (AlphAI's list: forward, turns, rotations of 15° to 180°, stop, red light) and their buttons |
| `src/sim/ai-mode.js` | The same program in JavaScript, for the virtual robot |
| `src/components/AiLab.jsx`, `ActionIcon.jsx` | The AI Lab screen: sensors, network, actions; the Actions settings |
| `src/ai/i18n-ai.js` | The texts (English for now) |
| `tests/test_ai_mode.py`, `tests/ai.test.js`, `tests/golden-ai.json` | The program tested on a virtual robot; the JavaScript copy checked against the Python one, tick by tick |

## Plan

1. **Robot link for actions** ✅ this step. Drive the robot with the action buttons; choose the actions, their duration, the
   pause and the max speed (AlphAI's Actions tab).
2. **Supervised learning** (A1, A3, A4, A5): Sensors and AI tabs, a network with hidden layers ("10 20"), the control bar
   (learning, self-drive, single step, forget last action, reset learning), teaching by clicking an action. Black lines in the
   virtual arena.
3. **Reinforcement learning** (A2): rewards (+100 straight, +55 turning, −50 penalty), reward and level bars, exploration,
   green and red lights, the value of each action in step-by-step mode.
4. **Finishing**: save and load settings, ready-made settings for each activity, sharing by QR code.

## Status of step 1

Tested without a robot: the Python program on a virtual robot (`python3 -I tests/test_ai_mode.py`), the JavaScript copy
against it, the whole Bluetooth link against the demo robot (`node tests/link.test.js`), and the page in a browser (computer,
tablet, phone, light and dark).

**To check on a real Thymio 3:**

- the program starts (the first time it is installed, about 4 s);
- the sensor numbers move when a hand comes close, and the **ground sensor values** on a light floor and on a black line
  (the program uses `thymio.GROUND(0)` and `GROUND(1)`; the virtual robot guesses 900 and 120);
- an action button makes the robot move, and how long it takes to react;
- **"turn 90°"** really turns a quarter turn; if not, the *Turn calibration* slider corrects it: please note the value that
  works;
- the centre button of the robot stops the program.
