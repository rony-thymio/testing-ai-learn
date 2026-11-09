// The MicroPython mode that runs on the robot (src/py/ann_mode.py) as a module for the robot's file system.
import SOURCE from './py/ann_mode.py?raw';
import AI_SOURCE from './py/ai_mode.py?raw';
import { buildModuleFrom, moduleNameFor, AI_MODULE_PREFIX } from './script-core.js';

export const SOURCE_TEXT = SOURCE;
export const MODULE_TEXT = buildModuleFrom(SOURCE);
export const MODULE_NAME = moduleNameFor(MODULE_TEXT);

// The AI Lab program (src/py/ai_mode.py), the same way.
export const AI_MODULE_TEXT = buildModuleFrom(AI_SOURCE);
export const AI_MODULE_NAME = moduleNameFor(AI_MODULE_TEXT, AI_MODULE_PREFIX);
