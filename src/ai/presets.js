// Ready-made settings for the five activities (the "sample settings" of the activity sheets): the sensors, the actions, how
// they are carried out, and the AI. The activities let the teams change the actions and their settings; these are a start.
export const PRESETS = [
  {
    id: 'a1',
    sensors: { proximity: 'all', proxBinary: false, ground: 'off' },
    actions: [2, 0],                                         // backward, stop: "Thymio the fearful"
    actionSettings: { duration: 0.25, pause: 0.1, maxSpeed: 150 },
    ai: { kind: 'supervised', hidden: [10, 20] },
  },
  {
    id: 'a2',
    sensors: { proximity: 'front', proxBinary: false, ground: 'off' },
    actions: [1, 5, 6, 9, 10],                               // forward, forward to the left / right, backward to the left / right
    actionSettings: { duration: 0.25, pause: 0.1, maxSpeed: 150 },
    ai: { kind: 'reinforcement', hidden: [10, 20], penalty: 1, exploration: true },
  },
  {
    id: 'a3',
    sensors: { proximity: 'off', proxBinary: false, ground: 'values' },
    actions: [1, 5, 6],                                      // forward, forward to the left / right: following a black track
    actionSettings: { duration: 0.15, pause: 0.1, maxSpeed: 200 },
    ai: { kind: 'supervised', hidden: [10, 20] },
  },
  {
    id: 'a4',
    sensors: { proximity: 'front', proxBinary: false, ground: 'off' },
    actions: [1, 2, 17, 18],                                 // forward, backward, turn 90° left / right
    actionSettings: { duration: 0.25, pause: 0.1, maxSpeed: 150 },
    ai: { kind: 'supervised', hidden: [10, 20] },
  },
  {
    id: 'a5',
    sensors: { proximity: 'front', proxBinary: false, ground: 'values' },
    actions: [1, 5, 6, 0],                                   // the road (ground) and the obstacles on it (front)
    actionSettings: { duration: 0.15, pause: 0.1, maxSpeed: 200 },
    ai: { kind: 'supervised', hidden: [10, 20] },
  },
];
