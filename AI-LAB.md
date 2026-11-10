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

## What the AI Lab does now (step 2: supervised learning)

Laid out like AlphAI (from the activities and a screen recording of AlphAI with a Thymio 2):

- **Headline**: "Supervised learning (paused), piloted / autonomous. Training data: N."
- **Control bar**: Autonomous (also the space bar), Step by step, Learn, Forget the last, Reset AI, Speed.
- **Sensors**: the values the network sees, from 0 to 1 (proximity: reading / 4000; black detection: 1 − ground / 1000),
  and the last action.
- **Neural network**: inputs, intermediate layers, actions. Thickness = strength of the connection; yellow = pushes towards
  an action now, blue = holds it back.
- **Actions** with the network's score (%) — the highest in orange — and the number of examples of each.
- **Settings**: Sensors (proximity all / front / none, binary mode; ground off / black-or-white / values), Actions (AlphAI's
  grid, now with green and blue lights; duration, pause, max speed, angle adjustment), AI (learning speed, intermediate layers
  such as "10 20", the training data).

How it works: with **Learn** on, clicking an action makes the robot do it and saves the situation (the sensors) with that
action as an example; the network (`src/ai/brain.js`: tanh hidden layers, softmax outputs, gradient descent) learns from all
the examples continuously. In **autonomous** mode, each time the robot says an action is done it also sends its sensors, and
the page answers with the action the network scores highest (`src/ai/useAiLab.js`). With no pause, drive actions flow into
each other (the wheels keep turning 0.4 s waiting for the next action). The examples are kept in the browser.

Tested without a robot: the network learns the situations of activities 1, 3 and 5 (`tests/brain.test.js`); the virtual robot,
taught to avoid obstacles, drives itself for two minutes without touching a wall (`tests/autonomous.test.js`); the whole
Bluetooth chain with the simulated robot (teach, autonomous, stop).

## Step 3: reinforcement learning, sharing, a design of our own

- **Reinforcement learning** (activity 2): AI settings → Type of learning. The robot tries actions; after each one it gets a
  reward from its front sensors (+100 forward straight, +55 forward turning, −50 × penalty for a bad move, 0 otherwise),
  glows green or red, and the network learns the value of each action (Q-learning with a slowly updated copy of the network).
  Reward and level bars (level = mean of the last minute), Exploration button (an explored action is shown in blue), the
  penalty setting. Tested: on the virtual robot in an arena with walls, the level goes from about 45 to 65 in five minutes.
- **Ready-made settings** for activities 1 to 5 (AI settings).
- **Share this AI**: a QR code, a link (`#ai=…`, the page offers to use it) or a file. It carries the sensors, the actions and
  their settings, the kind of learning, the examples and the network: another tablet drives its robot the same way at once.
- **Design**: the actions are drawn as the Thymio seen from above with an arrow on each wheel (blue forward, red backward), a
  slice for the angle of a pivot, the body coloured for a light; the network as in the Neurons mode (each sensor in its colour,
  blue/red connections, "+" neurons).
- The version before this redesign is kept in the branch `backup-v2-alphai-look`.

## Plan

1. Robot link for actions ✅
2. Supervised learning ✅ (A1, A3, A4, A5)
3. Reinforcement learning ✅ (A2), sharing ✅, ready-made settings ✅
4. Next: the Graphs window, manual editing of weights, black lines in the virtual arena, other languages.

## To check on a real Thymio 3

- The **ground sensor** values on white and on black (black detection should be near 0 on white, near 1 on black; if not,
  `GROUND_WHITE` in `src/ai/brain.js` is adjusted).
- **Turn 90°** turns a quarter turn (otherwise: Angle adjustment, and tell us the value).
- Autonomous mode: how smoothly it chains actions, with and without pause.
